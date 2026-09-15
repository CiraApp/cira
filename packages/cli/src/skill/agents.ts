import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CanonicalSkill } from "@cira/skill";
import {
  onPath,
  sharedSkillsDir,
  writeSkill,
  type InstallResult,
  type SkillEnv,
  type SkillInstaller,
} from "./installer.js";

/**
 * The agents that speak Agent Skills.
 *
 * Four of the five supported agents read a `SKILL.md` out of a directory, so
 * they differ only in which directory. Three of those four read the shared one.
 */

/**
 * Claude Code reads personal skills from `~/.claude/skills` and nowhere else -
 * it does not look in `~/.agents/skills` - so it keeps its own copy.
 */
export function claudeCode(env: SkillEnv): SkillInstaller {
  const home = process.env["CLAUDE_CONFIG_DIR"] ?? join(env.home, ".claude");

  return {
    name: "Claude Code",
    detect: () => Promise.resolve(existsSync(home) || onPath(env, "claude")),
    install: (skill: CanonicalSkill): Promise<InstallResult> =>
      Promise.resolve(writeSkill(join(home, "skills"), skill)),
  };
}

/** Codex documents `$HOME/.agents/skills` as its user scope. */
export function codex(env: SkillEnv): SkillInstaller {
  const home = process.env["CODEX_HOME"] ?? join(env.home, ".codex");

  return {
    name: "Codex",
    detect: () => Promise.resolve(existsSync(home) || onPath(env, "codex")),
    install: (skill: CanonicalSkill): Promise<InstallResult> =>
      Promise.resolve(writeSkill(sharedSkillsDir(env), skill)),
  };
}

/** Pi reads `~/.pi/agent/skills` and the shared directory. */
export function pi(env: SkillEnv): SkillInstaller {
  return {
    name: "Pi",
    detect: () => Promise.resolve(existsSync(join(env.home, ".pi")) || onPath(env, "pi")),
    install: (skill: CanonicalSkill): Promise<InstallResult> =>
      Promise.resolve(writeSkill(sharedSkillsDir(env), skill)),
  };
}

/**
 * Gemini CLI reads both, and the shared directory wins where a skill appears
 * in each - so writing only there leaves no stale copy to take precedence.
 */
export function geminiCli(env: SkillEnv): SkillInstaller {
  return {
    name: "Gemini CLI",
    detect: () =>
      Promise.resolve(existsSync(join(env.home, ".gemini")) || onPath(env, "gemini")),
    install: (skill: CanonicalSkill): Promise<InstallResult> =>
      Promise.resolve(writeSkill(sharedSkillsDir(env), skill)),
  };
}
