import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { canonicalSkill } from "@cira/skill";
import { installers, type SkillInstaller } from "../skill/index.js";
import { bold, dim, fail, info, success } from "../ui.js";
import { checkForUpdate, type FetchLatest } from "./check.js";
import {
  readSkillState,
  readUpdateState,
  writeSkillState,
  writeUpdateState,
} from "./state.js";

export { checkForUpdate, TTL_MS } from "./check.js";
export { currentVersion, isNewer } from "./version.js";

const run = promisify(execFile);

/**
 * Keeping Cira current.
 *
 * Three jobs and no more: ask whether a newer release exists, install it the
 * way the CLI was installed, and bring the skill copies the developer already
 * approved along with it. Everything about versions lives here rather than
 * being sprinkled through the commands.
 */

export type CliUpdater = (version: string) => Promise<void>;

/**
 * Update through npm, because `npm i -g @cira-app/cli` is what the product
 * tells developers to run. There is deliberately no detection of other package
 * managers: supporting a channel Cira does not publish to would be guessing.
 */
export const npmUpdater: CliUpdater = async (version) => {
  await run("npm", ["install", "-g", `@cira-app/cli@${version}`], {
    timeout: 120_000,
    windowsHide: true,
  });
};

export interface UpdateOptions {
  fetchLatest?: FetchLatest;
  updateCli?: CliUpdater;
  agents?: readonly SkillInstaller[];
}

/**
 * `cira update`.
 *
 * Always asks the registry directly: someone who typed the word is owed a
 * fresh answer, not whatever was cached this morning.
 */
export async function updateCommand(options: UpdateOptions = {}): Promise<number> {
  info("");
  info(dim("Checking for updates..."));

  const check = await checkForUpdate({ force: true, ...pick(options, "fetchLatest") });

  if (!check.hasUpdate || check.latest === null) {
    info("");
    success("Cira is up to date.");
    info("");
    return 0;
  }

  info("");
  info(bold("CLI"));
  info(`  ${check.current} → ${check.latest}`);
  info("");
  info(dim("Updating..."));
  info("");

  try {
    await (options.updateCli ?? npmUpdater)(check.latest);
  } catch (error) {
    fail("CLI update failed.");
    info(dim("  Your existing installation was left unchanged."));
    info(dim(`  ${error instanceof Error ? error.message : "npm could not run."}`));
    info("");
    // Nothing else runs: the skill that ships with a version we may or may not
    // now have is not something to guess about.
    return 1;
  }

  success("CLI updated");

  const results = await syncInstalledSkills(check.latest, options.agents);
  for (const result of results) {
    if (result.ok) success(`Cira Skill updated for ${result.agent}`);
    else fail(`Cira Skill update failed for ${result.agent} ${dim(result.why)}`);
  }

  const state = readUpdateState();
  writeUpdateState({ ...state, lastNotifiedVersion: check.latest });

  info("");
  if (results.some((r) => !r.ok)) {
    info("  Cira is updated, but some Skill installations need attention.");
  } else {
    success("Cira is up to date.");
  }
  info("");
  return 0;
}

export interface SyncResult {
  agent: string;
  ok: boolean;
  why: string;
}

/**
 * Bring approved skill copies up to the new release.
 *
 * Only targets the developer already said yes to, and only those they left on
 * auto-update. An agent installed since is not touched: consent was given for
 * the tools they had, and finding Cira in a tool they never approved is the
 * thing this whole flow exists to avoid.
 */
export async function syncInstalledSkills(
  version: string,
  agents: readonly SkillInstaller[] = installers(),
): Promise<SyncResult[]> {
  const state = readSkillState();
  const skill = canonicalSkill();
  const results: SyncResult[] = [];

  for (const agent of agents) {
    const target = state.targets[agent.id];
    if (target === undefined || !target.installed || !target.autoUpdate) continue;

    try {
      const outcome = await agent.install(skill);
      results.push({
        agent: agent.name,
        ok: outcome.ok,
        why: outcome.ok ? outcome.where : outcome.why,
      });
    } catch (error) {
      // One agent failing is reported against that agent; the rest still get
      // the new skill.
      results.push({
        agent: agent.name,
        ok: false,
        why: error instanceof Error ? error.message : "could not write the skill",
      });
    }
  }

  if (results.some((r) => r.ok)) {
    writeSkillState({ ...state, skillVersion: version });
  }

  return results;
}

/**
 * The passive check, started before the requested command and read after it.
 *
 * Returns a handle rather than awaiting anything, so `cira status` runs at the
 * speed it always did. Nothing here can make a command slower than the short
 * grace period at the end, and nothing here can make one fail.
 */
export interface PendingCheck {
  result: Promise<{ latest: string | null; hasUpdate: boolean } | null>;
  cancel: () => void;
}

export function beginUpdateCheck(options: UpdateOptions = {}): PendingCheck {
  const controller = new AbortController();

  const result = checkForUpdate({
    signal: controller.signal,
    ...pick(options, "fetchLatest"),
  })
    .then((check) => ({ latest: check.latest, hasUpdate: check.hasUpdate }))
    .catch(() => null);

  return { result, cancel: () => controller.abort() };
}

/** How long a finished command will wait for an answer that may not come. */
const GRACE_MS = 100;

/**
 * Print the notice, if there is one and it has not been given already.
 *
 * Waits only a moment: the check either finished while the command ran or it
 * did not, and a developer who asked for a deploy did not ask to wait on the
 * registry. Abandoning it is free - the next command will look again.
 */
export async function finishUpdateCheck(pending: PendingCheck): Promise<void> {
  const timeout = new Promise<null>((resolve) => {
    const timer = setTimeout(() => resolve(null), GRACE_MS);
    // Never hold the process open for the sake of a notice.
    timer.unref?.();
  });

  const check = await Promise.race([pending.result, timeout]);
  pending.cancel();

  if (check === null || !check.hasUpdate || check.latest === null) return;

  const state = readUpdateState();
  if (state.lastNotifiedVersion === check.latest) return;

  info("");
  info(`  Cira ${bold(check.latest)} is available.`);
  info(dim("  Run `cira update`."));

  writeUpdateState({ ...state, lastNotifiedVersion: check.latest });
}

/** Narrow an options bag without letting `undefined` override a default. */
function pick<T extends object, K extends keyof T>(source: T, key: K): Partial<T> {
  return source[key] === undefined ? {} : ({ [key]: source[key] } as Partial<T>);
}
