import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CanonicalSkill } from "@cira/skill";
import {
  onPath,
  type InstallResult,
  type SkillEnv,
  type SkillInstaller,
} from "./installer.js";

/**
 * Cursor reads project rules from `.cursor/rules/*.mdc`.
 *
 * Unlike the other two it has no home-directory location: its global "User
 * Rules" live inside Cursor's own settings, not in a file anything else can
 * write. So this one installs into the project you are standing in, and says
 * so plainly when you are not standing in one rather than writing a stray
 * `.cursor` folder into a home directory.
 *
 * `.mdc` needs its own frontmatter - `description`, `globs`, `alwaysApply` -
 * and ignores a plain `.md`. That is the one place a provider forces an
 * adaptation, and it is the wrapper only: the body below is unchanged.
 */
export function cursor(env: SkillEnv): SkillInstaller {
  return {
    name: "Cursor",

    detect: () =>
      Promise.resolve(
        existsSync(join(env.home, ".cursor")) ||
          existsSync(join(env.home, ".config", "Cursor")) ||
          existsSync(join(env.home, "Library", "Application Support", "Cursor")) ||
          // On WSL the editor is installed on the Windows side: its binary is
          // reachable while its configuration directory is not.
          onPath(env, "cursor"),
      ),

    install: (skill: CanonicalSkill): Promise<InstallResult> => {
      if (!isProject(env.cwd)) {
        return Promise.resolve({
          ok: false,
          why: "run this from a project folder - Cursor rules live in the project",
        });
      }

      const directory = join(env.cwd, ".cursor", "rules");
      mkdirSync(directory, { recursive: true });

      const path = join(directory, `${skill.name}.mdc`);
      const frontmatter = [
        "---",
        `description: ${skill.description}`,
        "globs:",
        "alwaysApply: false",
        "---",
      ].join("\n");

      writeFileSync(path, `${frontmatter}\n\n${skill.body.trim()}\n`);

      return Promise.resolve({ ok: true, where: path });
    },
  };
}

/** A folder somebody is actually working in, rather than wherever they stood. */
function isProject(dir: string): boolean {
  return (
    existsSync(join(dir, "package.json")) ||
    existsSync(join(dir, ".git")) ||
    existsSync(join(dir, "pyproject.toml")) ||
    existsSync(join(dir, "go.mod"))
  );
}
