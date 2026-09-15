import { basename } from "node:path";
import { api, ApiError } from "./api.js";
import { readConfig } from "./config.js";
import { collectFiles, readFileBody, readSourceFiles } from "./files.js";
import { extractRepo } from "@cira/extract";
import { detectFramework, readProjectLink, writeProjectLink } from "./project.js";
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
  enabled: number;
  review: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  const framework = detectFramework(root);
  if (framework === null) {
    fail("This folder is not a Next.js app. Cira deploys Next.js in V1.");
    return 1;
  }
  success("Next.js app");

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

  const bytes = files.reduce((n, f) => n + f.size, 0);
  info(`${dim(`Packaging ${files.length} files (${formatBytes(bytes)})...`)}`);

  for (const file of files) {
    try {
      await api("/api/cli/upload", {
        method: "POST",
        body: undefined,
        raw: { sha: file.sha, body: readFileBody(root, file.path) },
      });
    } catch (error) {
      fail(
        error instanceof ApiError
          ? `${error.message} while uploading ${file.path}`
          : `Could not upload ${file.path}.`,
      );
      return 1;
    }
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
        files,
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

  // Analysis needs the app id and the code, not a finished deployment, so it
  // runs while the build is going out. By the time the app is live the answer
  // is usually already back, and capability detection costs no extra waiting.
  info(`${dim("Analyzing capabilities...")}`);
  const analysis = api<CapabilitiesResponse>("/api/cli/capabilities", {
    method: "POST",
    body: {
      appId: started.appId,
      summary: extractRepo(readSourceFiles(root, files)),
    },
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

      await reportCapabilities(await analysis);
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
async function reportCapabilities(result: CapabilitiesResponse | Error): Promise<void> {
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
  const parts: string[] = [];
  if (result.enabled > 0) parts.push(`${result.enabled} enabled`);
  if (result.review > 0) parts.push(`${result.review} awaiting review`);
  info(`  ${parts.join(", ")}`);
  if (result.review > 0) {
    info(dim("  Anything that writes stays off until someone turns it on."));
  }
  info("");
}
