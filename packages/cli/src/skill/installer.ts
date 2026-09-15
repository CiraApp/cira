import type { CanonicalSkill } from "@cira/skill";

/**
 * Installing the Cira Skill into one coding agent.
 *
 * Three implementations and no more abstraction than three need. Each one
 * answers two questions - is this agent here, and where does its skill go -
 * and nothing about what the skill says. That stays in `@cira/skill`.
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
   * Not an error: the agent is here but this is not the moment or place to
   * install for it. Cursor's rules are per project, so running `cira login`
   * from a home directory is exactly this case.
   */
  | { ok: false; why: string };

/**
 * Where an installer is allowed to look and write.
 *
 * Passed in rather than read from the process, so the tests can run every
 * installer against a real temporary directory instead of mocking a
 * filesystem. What these do is write files; a test that does not write files
 * is testing something else.
 */
export interface SkillEnv {
  home: string;
  cwd: string;
}

/** The markers around Cira's section of a file it does not own. */
export const BLOCK_START = "<!-- cira:skill:start -->";
export const BLOCK_END = "<!-- cira:skill:end -->";

/**
 * Put Cira's section into a file that may already have someone else's
 * instructions in it, and put it in the same place every time.
 *
 * Codex keeps global instructions in one `AGENTS.md` that belongs to the
 * developer, so overwriting it would destroy their own work. A delimited block
 * is what makes installing twice a no-op rather than a duplication, and what
 * lets a person delete Cira's part without hunting for where it ends.
 */
export function mergeBlock(existing: string, contents: string): string {
  const block = `${BLOCK_START}\n${contents.trim()}\n${BLOCK_END}`;

  const start = existing.indexOf(BLOCK_START);
  const end = existing.indexOf(BLOCK_END);

  if (start !== -1 && end !== -1 && end > start) {
    const before = existing.slice(0, start);
    const after = existing.slice(end + BLOCK_END.length);
    return `${before}${block}${after}`.trimEnd() + "\n";
  }

  if (existing.trim() === "") return `${block}\n`;
  return `${existing.trimEnd()}\n\n${block}\n`;
}
