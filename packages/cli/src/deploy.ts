import { basename } from "node:path";
import { api, ApiError } from "./api.js";
import { readConfig } from "./config.js";
import { collectFiles, readFileBody } from "./files.js";
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function deploy(): Promise<number> {
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

  const spaceSlug = link?.spaceSlug ?? me.spaces[0]?.slug;
  if (spaceSlug === undefined) {
    fail("You are not in a space yet. Open Cira and join or create one first.");
    return 1;
  }

  if (link === null && me.spaces.length > 1) {
    // Guessing which company to publish someone's work into is not a guess
    // worth making.
    fail(
      "You are in more than one space. Deploy from a linked folder, or ask for --space.",
    );
    info(dim(`  Spaces: ${me.spaces.map((s) => s.slug).join(", ")}`));
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
