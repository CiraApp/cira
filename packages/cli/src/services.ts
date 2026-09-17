import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Framework } from "@cira/core";
import { detectFramework } from "./project.js";
import { readDockerfile } from "@cira/deploy/packaging";

/**
 * Finding the deployable halves of a repository.
 *
 * A great deal of internal software is a frontend and the API behind it, and
 * the two are not two entries on a shelf - they are one product. They do have
 * to be built separately, though, because each half already says how it wants
 * to be built and neither says anything about being built with the other.
 *
 * Nothing here asks the developer to write any of it down. A repository that
 * contains two deployable things has already said so, in the only way that
 * matters: each half has the files its own toolchain needs.
 */

/** Where a monorepo conventionally keeps the things it deploys. */
const CONTAINERS = ["apps", "services"] as const;

/**
 * Frameworks that put pages in front of a person, as opposed to answering
 * another program. Which of an app's halves takes the port is decided by this,
 * and it has to be decided before anything is deployed - there is no running
 * service to ask yet.
 */
const BROWSER_FACING: ReadonlySet<Framework> = new Set(["nextjs", "node"]);

export interface DiscoveredService {
  /** Names it to a person, and in the deployment. */
  slug: string;
  /** Relative to the repository root. Empty for the root itself. */
  sourcePath: string;
  framework: Framework;
  /** Relative to the repository root, so the build context stays the root. */
  dockerfile: string | null;
  port: number | null;
}

export interface Discovery {
  services: DiscoveredService[];
  /** The one that takes the port. Null when it could not be worked out. */
  ingress: DiscoveredService | null;
  /** Why the ingress could not be chosen, for saying so plainly. */
  ambiguity: string | null;
}

export function discoverServices(root: string): Discovery {
  const parts = deployableParts(root);

  // The ordinary case, and the one almost every app is: one thing, built from
  // the directory the developer is standing in. Unchanged by any of this.
  if (parts.length <= 1) {
    const only = parts[0] ?? describe(root, "", "app");
    return { services: [only], ingress: only, ambiguity: null };
  }

  const facing = parts.filter((part) => BROWSER_FACING.has(part.framework));

  // `nextjs` beats a bare `node`, because a repository with a Next frontend and
  // a Node API has two services that both look browser-facing and only one of
  // them is.
  const preferred = facing.filter((part) => part.framework === "nextjs");
  const candidates = preferred.length > 0 ? preferred : facing;

  if (candidates.length !== 1) {
    return {
      services: parts,
      ingress: null,
      ambiguity:
        candidates.length === 0
          ? "none of them looks like the half a browser opens"
          : `${candidates.map((c) => c.slug).join(" and ")} both look like the half a browser opens`,
    };
  }

  return {
    services: parts,
    ingress: candidates[0] as DiscoveredService,
    ambiguity: null,
  };
}

/** Everything in this repository that could be built and run on its own. */
function deployableParts(root: string): DiscoveredService[] {
  const found: DiscoveredService[] = [];

  for (const container of CONTAINERS) {
    const dir = join(root, container);
    if (!isDirectory(dir)) continue;

    for (const entry of readdirSync(dir).sort()) {
      const path = join(dir, entry);
      if (!isDirectory(path)) continue;
      if (!isDeployable(path)) continue;
      found.push(describe(path, `${container}/${entry}`, entry));
    }
  }

  // A root that is only holding the workspace together is not a service, even
  // though its package.json makes it look like one.
  if (found.length > 0) return found;
  return isDeployable(root) ? [describe(root, "", "app")] : [];
}

/**
 * Is there enough here to build and start something?
 *
 * A Dockerfile is the strongest possible yes - it is the directory saying so
 * outright. Otherwise a recognised toolchain, which is what the buildpacks
 * would go looking for anyway.
 */
function isDeployable(dir: string): boolean {
  if (existsSync(join(dir, "Dockerfile"))) return true;
  if (detectFramework(dir) === "unknown") return false;
  // A package with no way to start is a library, and every monorepo is full of
  // them. `apps/*` is the convention for the ones that run, but conventions get
  // broken and this is cheap to check.
  return hasStartScript(dir) || existsSync(join(dir, "Dockerfile"));
}

function hasStartScript(dir: string): boolean {
  const file = join(dir, "package.json");
  if (!existsSync(file)) return true; // Not a Node package; nothing to disprove.

  try {
    const pkg = JSON.parse(readFileSync(file, "utf8")) as {
      scripts?: Record<string, string>;
    };
    const scripts = pkg.scripts ?? {};
    return scripts["start"] !== undefined || scripts["dev"] !== undefined;
  } catch {
    return true;
  }
}

function describe(dir: string, sourcePath: string, slug: string): DiscoveredService {
  const dockerfile = join(dir, "Dockerfile");
  const present = existsSync(dockerfile);

  let port: number | null = null;
  if (present) {
    try {
      port = readDockerfile(readFileSync(dockerfile, "utf8")).port;
    } catch {
      // An unreadable Dockerfile is still a Dockerfile; the build will say so.
    }
  }

  return {
    slug: slugify(slug),
    sourcePath,
    framework: detectFramework(dir),
    // Named from the repository root, because that is the build context: the
    // lockfile a monorepo builds from lives there, not beside the service.
    dockerfile: present
      ? sourcePath === ""
        ? "Dockerfile"
        : `${sourcePath}/Dockerfile`
      : null,
    port,
  };
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The CLI cannot import core's slugify without pulling in the world. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}
