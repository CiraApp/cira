import { createInterface } from "node:readline/promises";
import { bold, dim, fail, info, success } from "../ui.js";
import { detectAgents, installSkill, type InstallReport } from "./index.js";

/**
 * `cira skill install`.
 *
 * The fallback for anyone who declined during login, added an agent later, or
 * is standing in a project and wants Cursor's rules written there. It asks
 * nothing and simply installs.
 */
export async function skillCommand(argv: string[]): Promise<number> {
  const action = argv[0] ?? "install";

  if (action !== "install") {
    fail(`Unknown skill command: ${action}`);
    info(dim("  Try: cira skill install"));
    return 1;
  }

  const agents = await detectAgents();

  info("");
  info(bold("Cira Skill"));
  info("");

  if (agents.length === 0) {
    info(dim("  No supported coding agents detected."));
    info(dim("  Cira installs into Claude Code, Codex and Cursor."));
    info("");
    return 0;
  }

  report(await installSkill(agents));
  return 0;
}

/**
 * Offered once, at the end of `cira login`.
 *
 * Installing by default is what makes the skill feel built in, and asking is
 * what keeps it honest: nothing modifies a developer's coding agents without
 * them seeing the question. Declining is one keystroke and is remembered by
 * simply not happening.
 */
export async function offerSkill(): Promise<void> {
  const agents = await detectAgents();

  if (agents.length === 0) {
    info("");
    info(dim("  No supported coding agents detected."));
    info(dim("  You can install the Cira Skill later with: cira skill install"));
    info("");
    return;
  }

  info("");
  info("  Coding agents detected:");
  info("");
  for (const agent of agents) info(`    ${agent.name}`);
  info("");

  if (!(await confirm("  Install the Cira Skill? [Y/n] "))) {
    info("");
    info(dim("  Left alone. Install later with: cira skill install"));
    info("");
    return;
  }

  info("");
  report(await installSkill(agents));
}

function report(reports: readonly InstallReport[]): void {
  for (const entry of reports) {
    if (entry.result.ok) success(`${entry.agent} ${dim(entry.result.where)}`);
    else info(`  - ${entry.agent} ${dim(entry.result.why)}`);
  }

  const installed = reports.filter((r) => r.result.ok).length;
  info("");
  if (installed > 0) info(`  ${bold("You're ready.")}`);
  info("");
}

/**
 * Yes unless they say otherwise.
 *
 * Somewhere without a terminal - a script, CI, a container - cannot answer, so
 * it is not asked and nothing is written. Defaulting to yes there would be
 * exactly the silent modification this flow exists to avoid.
 */
async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    info(dim("  Not a terminal, so nothing was installed."));
    info(dim("  Run: cira skill install"));
    return false;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === "" || answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}
