import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { api, ApiError } from "./api.js";
import { readConfig } from "./config.js";
import { collectFiles } from "./files.js";
import { archiveProject, uploadSource } from "./source.js";
import { collectEnv } from "./env.js";
import type { Framework } from "@cira/core";
import { detectFramework, readProjectLink, writeProjectLink } from "./project.js";
import { checkBundle, isRootDockerfile, readDockerfile } from "@cira/deploy/packaging";
import { bold, dim, fail, info, success } from "./ui.js";

interface MeResponse {
  user: { name: string; email: string };
  spaces: Array<{ slug: string; name: string; role: string }>;
}

interface DeployResponse {
  appId: string;
  appSlug: string;
  spaceSlug: string;
  deploymentId: string;
}

interface StatusResponse {
  status: string;
  url: string | null;
}

interface CapabilitiesResponse {
  detected: Array<{ name: string; description: string; risk: string }>;
}

interface VerifyResponse {
  verified: number;
  rejected: number;
  inconclusive: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What to call each of these out loud. */
const FRAMEWORK_NAMES: Record<Framework, string> = {
  nextjs: "Next.js app",
  node: "Node.js app",
  python: "Python app",
  go: "Go app",
  ruby: "Ruby app",
  java: "Java app",
  php: "PHP app",
  dotnet: ".NET app",
  unknown: "Application",
};

export async function deploy(argv: string[] = []): Promise<number> {
  const requestedSpace = readFlag(argv, "--space");
  const config = readConfig();
  if (config.token === undefined) {
    fail("Not signed in. Run: cira login");
    return 1;
  }

  const root = process.cwd();

  info("");
  info(`${dim("Detecting application...")}`);
  // Never a reason to stop. The build works out what this is from the source
  // itself; this only decides what the app's page will call it.
  const framework = detectFramework(root);
  success(FRAMEWORK_NAMES[framework]);

  const link = readProjectLink(root);

  let me: MeResponse;
  try {
    me = await api<MeResponse>("/api/cli/me");
  } catch (error) {
    fail(error instanceof ApiError ? error.message : "Could not reach Cira.");
    return 1;
  }

  if (me.spaces.length === 0) {
    fail("You are not in a space yet. Open Cira and join or create one first.");
    return 1;
  }

  if (requestedSpace !== null && !me.spaces.some((s) => s.slug === requestedSpace)) {
    fail(`You are not in a space called "${requestedSpace}".`);
    info(dim(`  You are in: ${me.spaces.map((s) => s.slug).join(", ")}`));
    return 1;
  }

  // An explicit choice wins, then the folder's existing link, and only then a
  // single obvious space. Guessing which company to publish someone's work
  // into is not a guess worth making.
  const spaceSlug =
    requestedSpace ??
    link?.spaceSlug ??
    (me.spaces.length === 1 ? me.spaces[0]?.slug : undefined);

  if (spaceSlug === undefined) {
    fail("You are in more than one space, so tell Cira which one to deploy to.");
    info("");
    for (const s of me.spaces) {
      info(`  cira deploy --space ${s.slug}${dim(`   (${s.name})`)}`);
    }
    info("");
    return 1;
  }

  const files = collectFiles(root);
  if (files.length === 0) {
    fail("There is nothing to deploy in this folder.");
    return 1;
  }

  // Checked here rather than only on the server, because the server never sees
  // the files: it authorises an upload by size and Google enforces that size.
  // A 40 MB asset someone forgot to ignore is worth naming before the upload,
  // not after it.
  const bundle = checkBundle(files);
  if (!bundle.ok) {
    fail(bundle.reason);
    return 1;
  }

  // A Dockerfile is the project saying how it wants to be built and run, and
  // it is read here because the walk already has the file list. Without it the
  // build has to work the language out and then guess at an entrypoint, which
  // is where a great deal of real software stops.
  const container = readContainer(root, files);
  if (container !== null) {
    success(
      container.port === null
        ? "Dockerfile"
        : `Dockerfile, listening on ${container.port}`,
    );
  }

  const bytes = files.reduce((n, f) => n + f.size, 0);
  info(`${dim(`Packaging ${files.length} files (${formatBytes(bytes)})...`)}`);

  // Names are printed, values never are - not here, not on failure, not
  // anywhere. See docs/secrets.md.
  let collected;
  try {
    collected = collectEnv(root, argv);
  } catch (error) {
    fail(error instanceof Error ? error.message : "Could not read the env file.");
    return 1;
  }

  const names = Object.keys(collected.env).sort();
  if (names.length > 0) {
    info(
      `${dim(`Environment from ${collected.source ?? "flags"}:`)} ${names.join(", ")}`,
    );
  }

  // Worth interrupting for: the build inlines these into the JavaScript the
  // browser downloads, so a secret here is published the moment it ships and
  // rotating is the only fix.
  if (collected.publicNames.length > 0) {
    info("");
    info(`  ${bold("Public to anyone who opens the app:")}`);
    for (const name of collected.publicNames) info(`    ${name}`);
    info(`  ${dim("NEXT_PUBLIC_ variables are compiled into the browser bundle.")}`);
    info("");
  }

  // One archive, sent straight to storage. It does not pass through Cira,
  // which is what lets a project larger than a few megabytes deploy at all.
  let sourceId: string;
  try {
    sourceId = await uploadSource(archiveProject(root, files));
  } catch (error) {
    fail(error instanceof ApiError ? error.message : "Could not upload this project.");
    return 1;
  }
  success("Uploaded");

  info(`${dim(`Deploying to ${spaceSlug}...`)}`);

  let started: DeployResponse;
  try {
    started = await api<DeployResponse>("/api/cli/deploy", {
      method: "POST",
      body: {
        spaceSlug,
        appName: link === null ? prettyName(basename(root)) : basename(root),
        appId: link?.appId ?? null,
        sourceId,
        framework,
        container,
        env: collected.env,
      },
    });
  } catch (error) {
    fail(error instanceof ApiError ? error.message : "The deploy could not be started.");
    return 1;
  }

  writeProjectLink(
    {
      appId: started.appId,
      spaceId: "",
      spaceSlug: started.spaceSlug,
      appSlug: started.appSlug,
    },
    root,
  );

  // Cira reads the source itself, out of the archive just uploaded, so there
  // is nothing to send but its name. Started while the build is going out: by
  // the time the app is live the answer is usually already back, and finding
  // out what an app can do costs no extra waiting.
  info(`${dim("Analyzing capabilities...")}`);
  const analysis = api<CapabilitiesResponse>("/api/cli/capabilities", {
    method: "POST",
    body: { appId: started.appId, sourceId },
  }).catch((error: unknown) => (error instanceof Error ? error : new Error("failed")));

  const deadline = Date.now() + 10 * 60 * 1000;
  let last = "";

  while (Date.now() < deadline) {
    await sleep(3000);

    let status: StatusResponse;
    try {
      status = await api<StatusResponse>(
        `/api/cli/deploy/status?id=${encodeURIComponent(started.deploymentId)}`,
      );
    } catch {
      continue;
    }

    if (status.status !== last) {
      info(dim(`  ${status.status}...`));
      last = status.status;
    }

    if (status.status === "live") {
      info("");
      success("Deployed");
      info("");
      info(`  ${bold(`${config.apiUrl}/${started.spaceSlug}/${started.appSlug}`)}`);
      info("");
      info(dim("  Only you can see it. Give people access from that page."));

      // Nothing is published until the app itself confirms it serves the
      // route. That can only be asked now, which is why it is not part of the
      // analysis that ran while the build was going out.
      const found = await analysis;
      const confirmed = await confirmCapabilities(started.appId);
      reportCapabilities(found, confirmed);
      return 0;
    }

    if (status.status === "failed" || status.status === "removed") {
      info("");
      fail("The deploy did not finish. Open the app in Cira to see why.");
      return 1;
    }
  }

  fail("Timed out waiting for the deploy to finish.");
  return 1;
}

function prettyName(folder: string): string {
  const cleaned = folder.replace(/[-_]+/g, " ").trim();
  return cleaned === "" ? "App" : cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** What the folder's own Dockerfile says, or null when there is none. */
function readContainer(
  root: string,
  files: readonly { path: string }[],
): { port: number | null } | null {
  if (!files.some((file) => isRootDockerfile(file.path))) return null;
  try {
    return readDockerfile(readFileSync(join(root, "Dockerfile"), "utf8"));
  } catch {
    // Listed but unreadable. Building from it would fail anyway, so this falls
    // back to letting the builder work the project out.
    return null;
  }
}

/** Read `--flag value` or `--flag=value` from the arguments. */
function readFlag(argv: string[], flag: string): string | null {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === flag) return argv[i + 1] ?? null;
    if (arg !== undefined && arg.startsWith(`${flag}=`)) {
      return arg.slice(flag.length + 1);
    }
  }
  return null;
}

/**
 * What Cira found the app can do.
 *
 * Reported after the deploy rather than instead of it: capability analysis is
 * a normal part of shipping, and a deploy that worked is not made a failure by
 * analysis that did not.
 */
/**
 * Ask Cira to check the capabilities against the app that is now running.
 *
 * Quiet on failure. A deploy that worked is not made a failure by a check that
 * did not, and the app's page says plainly which capabilities have been
 * confirmed.
 */
async function confirmCapabilities(appId: string): Promise<VerifyResponse | null> {
  try {
    return await api<VerifyResponse>("/api/cli/capabilities/verify", {
      method: "POST",
      body: { appId },
    });
  } catch {
    // The app's page says which have been confirmed; a deploy that worked is
    // not a failure because the check afterwards did not.
    return null;
  }
}

function reportCapabilities(
  result: CapabilitiesResponse | Error,
  confirmed: VerifyResponse | null,
): void {
  if (result instanceof Error) {
    info("");
    info(dim(`  Capabilities were not analyzed: ${result.message}`));
    return;
  }

  if (result.detected.length === 0) {
    info("");
    info(dim("  No capabilities detected in this app."));
    return;
  }

  info("");
  info(`${bold("Capabilities")}`);
  info("");
  for (const capability of result.detected) {
    const mark = capability.risk === "read" ? " " : "!";
    info(`  ${mark} ${bold(capability.name)}`);
    info(`    ${dim(capability.description)}`);
  }

  info("");

  // What was found and what the app confirmed are different numbers, and
  // saying only the first would claim more than is true. Reading the code can
  // be wrong; the app is asked, and anything it will not answer for is dropped.
  if (confirmed === null) {
    info(dim("  Not confirmed yet. Open the app in Cira to see which are live."));
    info("");
    return;
  }

  if (confirmed.inconclusive) {
    info(dim("  This app answers every address, so none could be confirmed."));
    info("");
    return;
  }

  const reads = result.detected.filter((c) => c.risk === "read").length;
  const parts = [`${confirmed.verified} confirmed by the app`];
  if (confirmed.rejected > 0) parts.push(`${confirmed.rejected} it does not serve`);
  info(`  ${parts.join(", ")}`);

  if (confirmed.verified > reads) {
    info(dim("  Anything that writes stays off until someone turns it on."));
  }
  info("");
}
