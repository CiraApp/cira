import { mkdirSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CanonicalSkill } from "@cira/skill";
import type { InstallResult, SkillEnv, SkillInstaller } from "./installer.js";

/**
 * Claude Code reads Agent Skills from `~/.claude/skills/<name>/SKILL.md`.
 *
 * The one target whose native format is the canonical format, so the file is
 * written through byte for byte - frontmatter included.
 */
export function claudeCode(env: SkillEnv): SkillInstaller {
  const root = process.env["CLAUDE_CONFIG_DIR"] ?? join(env.home, ".claude");

  return {
    name: "Claude Code",

    detect: () => Promise.resolve(existsSync(root)),

    install: (skill: CanonicalSkill): Promise<InstallResult> => {
      const directory = join(root, "skills", skill.name);
      mkdirSync(directory, { recursive: true });

      const path = join(directory, "SKILL.md");
      writeFileSync(path, `${skill.source.trimEnd()}\n`);

      return Promise.resolve({ ok: true, where: path });
    },
  };
}
