import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { CanonicalSkill } from "@cira/skill";

/**
 * Installing the Cira Skill into one coding agent.
 *
 * Each implementation answers two questions - is this agent here, and where
 * does its skill go - and nothing about what the skill says. That stays in
 * `@cira/skill`.
 */
export interface SkillInstaller {
  /** As a developer would name it. */
  readonly name: string;
  /** Does this machine appear to have the agent? */
  detect(): Promise<boolean>;
  /** Write the skill. Reports where, or why not. */
  install(skill: CanonicalSkill): Promise<InstallResult>;
}

export type InstallResult =
  | { ok: true; where: string }
  /**
   * Not an error: the agent is here but this is not the place to install for
   * it. Cursor's rules are per project, so running `cira login` from a home
   * directory is exactly this case.
   */
  | { ok: false; why: string };

/**
 * Where an installer may look and write.
 *
 * Passed in rather than read from the process, so tests can run every
 * installer against a real temporary directory. `path` is here for the same
 * reason: detection consults it, and a test that inherited the real one would
 * find whatever happens to be installed on the machine running it.
 */
export interface SkillEnv {
  home: string;
  cwd: string;
  path: readonly string[];
}

/**
 * The shared skills directory.
 *
 * Codex, Pi and Gemini CLI all read `~/.agents/skills`, so Cira writes there
 * once instead of into three private directories. It is the agents'
 * convergence, not Cira's invention - which is the whole reason to prefer it:
 * the next agent to adopt it needs no code here at all.
 *
 * Claude Code is the exception and reads only its own directory, so it still
 * gets its own copy.
 */
export function sharedSkillsDir(env: SkillEnv): string {
  return join(env.home, ".agents", "skills");
}

/**
 * Write the canonical file into a skills directory, unchanged.
 *
 * Every agent that speaks Agent Skills takes the same `name`/`description`
 * frontmatter the canonical file already carries, so there is nothing to
 * adapt and nothing to fork.
 */
export function writeSkill(skillsDir: string, skill: CanonicalSkill): InstallResult {
  const directory = join(skillsDir, skill.name);
  mkdirSync(directory, { recursive: true });

  const path = join(directory, "SKILL.md");
  writeFileSync(path, `${skill.source.trimEnd()}\n`);

  return { ok: true, where: path };
}

/**
 * Is this command on the PATH?
 *
 * Checked as well as the config directory because an agent can be installed
 * without having been run yet, and because on WSL a Windows-installed editor
 * is reachable as a binary while its home directory is on the other side.
 */
export function onPath(env: SkillEnv, command: string): boolean {
  return env.path.some((dir) =>
    [command, `${command}.exe`, `${command}.cmd`].some((name) =>
      dir === "" ? false : existsSync(join(dir, name)),
    ),
  );
}

export function systemPath(): readonly string[] {
  return (process.env["PATH"] ?? "").split(delimiter).filter((p) => p !== "");
}
