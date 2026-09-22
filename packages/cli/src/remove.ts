import { createInterface } from "node:readline/promises";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { api, ApiError } from "./api.js";
import { readConfig } from "./config.js";
import { readProjectLink } from "./project.js";
import { bold, dim, fail, info, success } from "./ui.js";

interface RemoveResponse {
  removed: string;
  /** False when the app is down but its images could not be deleted. */
  images: boolean;
}

/**
 * Take an app down and remove what it left behind.
 *
 * Deploying is one command, so undeploying should be too. Doing it only from a
 * web page meant the tidy thing was the inconvenient thing, and what actually
 * happened was that dead apps stayed - each one holding a Cloud Run service
 * and every image it was ever built into.
 *
 * Irreversible, and treated that way: the app's name has to be typed. A prompt
 * people clear by reflex is not a confirmation.
 */
export async function remove(argv: string[] = []): Promise<number> {
  const config = readConfig();
  if (config.token === undefined) {
    fail("Not signed in. Run: cira login");
    return 1;
  }

  const root = process.cwd();
  const link = readProjectLink(root);

  const spaceSlug = readFlag(argv, "--space") ?? link?.spaceSlug ?? null;
  const appSlug = readFlag(argv, "--app") ?? link?.appSlug ?? null;

  if (spaceSlug === null || appSlug === null) {
    fail("This folder is not linked to a Cira app.");
    info("");
    info(`  ${dim("Name it instead:")} cira remove --space acme --app ledger`);
    info("");
    return 1;
  }

  info("");
  info(`This removes ${bold(`${spaceSlug}/${appSlug}`)} and everything it left behind:`);
  info(
    dim(
      "  the running app, its workers and scheduled runs, its images, and what Cira recorded about it.",
    ),
  );
  info(dim("  It cannot be undone."));
  info("");

  // `--confirm NAME` is how a script says it. `--yes` on its own, which is
  // what `cira deploy --yes` takes, is not enough here: removing is the one
  // command where the app's name has to be typed back, and quietly treating a
  // bare `--yes` as "no" used to leave a CI job thinking it had removed
  // something it had not.
  const named = readFlag(argv, "--confirm") ?? readFlag(argv, "--yes");
  if (named === null && (argv.includes("--yes") || argv.includes("-y"))) {
    fail("Removing needs the app's name, not only --yes.");
    info(`  ${dim("For example:")} cira remove --confirm "${appSlug}"`);
    return 1;
  }
  if (named === null && process.stdin.isTTY !== true) {
    fail(
      "Nothing was removed. With nobody at a terminal, pass the app's name with --confirm.",
    );
    return 1;
  }
  const confirm = named ?? (await ask(`Type the app's name to confirm: `)) ?? "";
  if (confirm.trim() === "") {
    fail("Nothing was removed.");
    return 1;
  }

  let result: RemoveResponse;
  try {
    result = await api<RemoveResponse>("/api/cli/remove", {
      method: "POST",
      body: { spaceSlug, appSlug, confirm },
    });
  } catch (error) {
    fail(error instanceof ApiError ? error.message : "The app could not be removed.");
    return 1;
  }

  // The link points at something that no longer exists, and leaving it would
  // make the next deploy from this folder look like a redeploy of a dead app.
  if (link !== null) {
    try {
      rmSync(join(root, ".cira", "project.json"));
    } catch {
      // Already gone is the outcome wanted.
    }
  }

  info("");
  success(`Removed ${result.removed}`);
  if (!result.images) {
    info(dim("  The app is down, but its images could not be deleted."));
  }
  info("");
  return 0;
}

/** Read `--flag value` or `--flag=value`. */
function readFlag(argv: string[], flag: string): string | null {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === flag) {
      const next = argv[i + 1];
      // The next flag is not this one's value.
      return next === undefined || next.startsWith("-") ? null : next;
    }
    if (arg !== undefined && arg.startsWith(`${flag}=`))
      return arg.slice(flag.length + 1);
  }
  return null;
}

async function ask(question: string): Promise<string | null> {
  if (!process.stdin.isTTY) return null;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(`  ${question}`);
  } finally {
    rl.close();
  }
}
