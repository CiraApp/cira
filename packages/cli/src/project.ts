import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

/** Which framework is this folder? Only Next.js is supported in V1. */
export function detectFramework(dir: string = process.cwd()): "nextjs" | null {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return null;

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return deps["next"] !== undefined ? "nextjs" : null;
  } catch {
    return null;
  }
}
