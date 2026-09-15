import { homedir } from "node:os";
import { canonicalSkill } from "@cira/skill";
import { claudeCode } from "./claude-code.js";
import { codex } from "./codex.js";
import { cursor } from "./cursor.js";
import type { InstallResult, SkillEnv, SkillInstaller } from "./installer.js";

export type { InstallResult, SkillEnv, SkillInstaller };
export { mergeBlock } from "./installer.js";

/** Every agent Cira knows how to install into, in the order they are shown. */
export function installers(env: SkillEnv = currentEnv()): SkillInstaller[] {
  return [claudeCode(env), codex(env), cursor(env)];
}

export function currentEnv(): SkillEnv {
  return { home: homedir(), cwd: process.cwd() };
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
 * outcome than a machine that tells you which one did not take.
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
