import { homedir } from "node:os";
import { canonicalSkill } from "@cira/skill";
import { claudeCode, codex, geminiCli, pi } from "./agents.js";
import { cursor } from "./cursor.js";
import {
  systemPath,
  type InstallResult,
  type SkillEnv,
  type SkillInstaller,
} from "./installer.js";

export type { InstallResult, SkillEnv, SkillInstaller };
export { sharedSkillsDir } from "./installer.js";

/** Every agent Cira knows how to install into, in the order they are shown. */
export function installers(env: SkillEnv = currentEnv()): SkillInstaller[] {
  return [claudeCode(env), codex(env), pi(env), geminiCli(env), cursor(env)];
}

export function currentEnv(): SkillEnv {
  return { home: homedir(), cwd: process.cwd(), path: systemPath() };
}

export async function detectAgents(
  env: SkillEnv = currentEnv(),
): Promise<SkillInstaller[]> {
  const found: SkillInstaller[] = [];
  for (const installer of installers(env)) {
    if (await installer.detect()) found.push(installer);
  }
  return found;
}

export interface InstallReport {
  agent: string;
  result: InstallResult;
}

/**
 * Install the skill into every detected agent.
 *
 * Each install is isolated: one agent failing is reported against that agent
 * and the rest still get the skill. A half-installed machine is a worse
 * outcome than one that tells you which agent did not take.
 *
 * Several agents resolve to the same shared file, so this writes it more than
 * once. That is deliberate - the same bytes to the same path is a no-op, and
 * it keeps every agent reporting the path it will actually read.
 */
export async function installSkill(
  agents: readonly SkillInstaller[],
): Promise<InstallReport[]> {
  const skill = canonicalSkill();
  const reports: InstallReport[] = [];

  for (const agent of agents) {
    try {
      reports.push({ agent: agent.name, result: await agent.install(skill) });
    } catch (error) {
      reports.push({
        agent: agent.name,
        result: {
          ok: false,
          why: error instanceof Error ? error.message : "could not write the skill",
        },
      });
    }
  }

  return reports;
}
