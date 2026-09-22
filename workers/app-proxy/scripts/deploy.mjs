import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

/**
 * Put the built proxy onto Cloudflare.
 *
 * This exists because nothing else deploys it. Cira itself goes out through CI
 * on every push, so a change to the web app is live minutes later without
 * anyone thinking about it - and the proxy sitting in the same repository
 * behaving differently is exactly the kind of difference nobody remembers.
 * Editing the worker and pushing does nothing at all; the old code keeps
 * running, silently, with no error anywhere to suggest otherwise.
 *
 * So: one command, and it says what it did.
 *
 * Called `ship` rather than `deploy` because pnpm has a built-in command by
 * that name which shadows a script, and `pnpm deploy` here fails with an error
 * about deploy targets that has nothing to do with anything.
 *
 * The bindings are deliberately re-sent every time rather than kept. A deploy
 * that leaves configuration behind is a deploy whose result depends on what
 * happened to be there already, and the first time that matters is the first
 * time someone deploys into an account that has never had this worker.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const SCRIPT = "cira-app-proxy";

function required(name, hint) {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Set ${name}. ${hint}`);
  }
  return value.trim();
}

/**
 * The API token, from the environment or from a file.
 *
 * A file by default, because the alternative is a token in shell history.
 */
function apiToken() {
  const inline = process.env["CLOUDFLARE_API_TOKEN"];
  if (inline !== undefined && inline.trim() !== "") return inline.trim();

  const path =
    process.env["CLOUDFLARE_TOKEN_FILE"] ?? join(homedir(), ".cloudflare-token");
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    throw new Error(
      `No Cloudflare token. Put one in ${path}, or set CLOUDFLARE_API_TOKEN. ` +
        `It needs Workers Scripts:Edit on the account and DNS:Edit plus ` +
        `Workers Routes:Edit on the zone.`,
    );
  }
}

const token = apiToken();
const account = required("CLOUDFLARE_ACCOUNT_ID", "The account that owns the zone.");
const ciraOrigin = required("CIRA_ORIGIN", "Where Cira answers, e.g. https://cira.dev.");
const appsDomain = required(
  "CIRA_APPS_DOMAIN",
  "Apps are served under this, e.g. cira.dev.",
);
const secret = required(
  "CIRA_PROXY_SECRET",
  "The same value Cira signs with. Cira verifies nothing it did not sign, so a mismatch locks everyone out of every app.",
);

// The secret has to be the one Cira runs with, and nothing here can see
// that - Vercel does not hand a sensitive value back, and a pulled copy of one
// was once shipped and locked everyone out of every app until it was rotated.
// So Cira is asked: its proxy-only route refuses a wrong secret with 401 and
// answers a right one, for a name no app has, with 404.
const probe = await fetch(new URL("/api/proxy/domain", ciraOrigin), {
  method: "POST",
  headers: { "content-type": "application/json", "x-cira-proxy-secret": secret },
  body: JSON.stringify({ hostname: "secret-check.invalid" }),
});
if (probe.status !== 404) {
  throw new Error(
    probe.status === 401
      ? "Cira does not accept this CIRA_PROXY_SECRET. Nothing was deployed: shipping it would lock everyone out of every app."
      : `Could not check the secret with Cira (${probe.status}). Nothing was deployed.`,
  );
}

const worker = join(root, "build", "worker.js");
let size;
try {
  size = statSync(worker).size;
} catch {
  throw new Error("Nothing built. Run `pnpm --filter @cira/app-proxy build` first.");
}

const metadata = {
  main_module: "worker.js",
  compatibility_date: "2026-01-01",
  bindings: [
    { type: "plain_text", name: "CIRA_ORIGIN", text: ciraOrigin },
    { type: "plain_text", name: "APPS_DOMAIN", text: appsDomain },
    { type: "secret_text", name: "CIRA_PROXY_SECRET", text: secret },
  ],
};

const form = new FormData();
form.set("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
form.set(
  "worker.js",
  new Blob([readFileSync(worker)], { type: "application/javascript+module" }),
  "worker.js",
);

const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${SCRIPT}`,
  { method: "PUT", headers: { authorization: `Bearer ${token}` }, body: form },
);

const body = await response.json();
if (!response.ok || body.success !== true) {
  const said = (body.errors ?? []).map((e) => `${e.code} ${e.message}`).join("; ");
  throw new Error(`Cloudflare refused the deploy: ${said || response.status}`);
}

process.stdout.write(
  `deployed ${SCRIPT} (${Math.round(size / 1024)} KB) to account ${account.slice(0, 8)}…\n` +
    `  apps domain: ${appsDomain}\n` +
    `  cira origin: ${ciraOrigin}\n` +
    `  secret:      set (${secret.length} chars)\n`,
);
