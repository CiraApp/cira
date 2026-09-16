import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Framework } from "@cira/core";

/**
 * Local metadata linking a folder to an app in Cira.
 *
 * Holds identifiers only, never a credential, so it is safe to commit and lets
 * a whole team redeploy the same app rather than each creating their own.
 */
export interface ProjectLink {
  appId: string;
  spaceId: string;
  spaceSlug: string;
  appSlug: string;
}

function linkPath(dir: string): string {
  return join(dir, ".cira", "project.json");
}

export function readProjectLink(dir: string = process.cwd()): ProjectLink | null {
  try {
    const raw = JSON.parse(readFileSync(linkPath(dir), "utf8")) as Partial<ProjectLink>;
    if (
      typeof raw.appId !== "string" ||
      typeof raw.spaceId !== "string" ||
      typeof raw.spaceSlug !== "string" ||
      typeof raw.appSlug !== "string"
    ) {
      return null;
    }
    return raw as ProjectLink;
  } catch {
    return null;
  }
}

export function writeProjectLink(link: ProjectLink, dir: string = process.cwd()): void {
  mkdirSync(join(dir, ".cira"), { recursive: true });
  writeFileSync(linkPath(dir), `${JSON.stringify(link, null, 2)}\n`);
}

/**
 * What this folder looks like it is written in.
 *
 * A label, not a gate. Cira used to refuse anything that was not Next.js,
 * which meant the only thing it ever deployed was frontends - and an internal
 * tool's interesting half is usually the API behind one. The build detects the
 * language from the source itself now, so being wrong here costs a wrong word
 * on an app's page and nothing else. `unknown` is a perfectly good answer.
 *
 * Ordered by how specific the evidence is. A Next.js app is also a Node
 * project, and a Python service with a small frontend is still Python.
 */
export function detectFramework(dir: string = process.cwd()): Framework {
  const has = (name: string): boolean => existsSync(join(dir, name));

  if (has("package.json")) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps["next"] !== undefined) return "nextjs";
    } catch {
      // An unreadable package.json is still a Node project.
    }
    return "node";
  }

  if (has("pyproject.toml") || has("requirements.txt") || has("Pipfile")) {
    return "python";
  }
  if (has("go.mod")) return "go";
  if (has("Gemfile")) return "ruby";
  if (has("pom.xml") || has("build.gradle") || has("build.gradle.kts")) return "java";
  if (has("composer.json")) return "php";

  return "unknown";
}
