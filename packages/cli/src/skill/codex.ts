import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CanonicalSkill } from "@cira/skill";
import {
  mergeBlock,
  type InstallResult,
  type SkillEnv,
  type SkillInstaller,
} from "./installer.js";

/**
 * Codex reads global instructions from `~/.codex/AGENTS.md`, which it layers
 * under anything a project says.
 *
 * That file belongs to the developer and probably already has their own
 * instructions in it, so Cira takes a delimited block rather than the file.
 * Frontmatter is dropped because AGENTS.md is plain markdown; the body is the
 * same body every other agent gets.
 */
export function codex(env: SkillEnv): SkillInstaller {
  const root = process.env["CODEX_HOME"] ?? join(env.home, ".codex");

  return {
    name: "Codex",

    detect: () => Promise.resolve(existsSync(root)),

    install: (skill: CanonicalSkill): Promise<InstallResult> => {
      const path = join(root, "AGENTS.md");
      const existing = existsSync(path) ? readFileSync(path, "utf8") : "";

      mkdirSync(root, { recursive: true });
      writeFileSync(path, mergeBlock(existing, skill.body));

      return Promise.resolve({ ok: true, where: path });
    },
  };
}
