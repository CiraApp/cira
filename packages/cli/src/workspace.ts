import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

/**
 * Deploying one app out of a JavaScript workspace.
 *
 * The default Turborepo layout - `apps/web`, `apps/docs`, `packages/ui`, one
 * lockfile at the root - is the most common shape a company's internal
 * software comes in, and Cira handled it badly both ways. From the root, two
 * Next.js apps read as two front doors of one product and the deploy was
 * refused. From inside `apps/web`, only that folder was uploaded, so the
 * build had no lockfile and no `packages/ui`, and failed.
 *
 * So a deploy from inside a workspace package uploads the whole workspace and
 * builds that one package. A package with its own Dockerfile keeps it; one
 * without gets a Dockerfile Cira writes into the upload - never into the
 * repository - which installs from the root lockfile with the workspace's own
 * package manager and builds the package and what it depends on.
 */

export type PackageManager = "pnpm" | "yarn" | "npm" | "bun";

export interface Workspace {
  /** The directory holding the workspace's lockfile and root package.json. */
  root: string;
  manager: PackageManager;
  /** Yarn 2 and later, which is started differently from Yarn 1. */
  yarnBerry: boolean;
  /** Whether a turbo.json is there to build a package with its dependencies. */
  turbo: boolean;
}

/** How far up from a package Cira looks for the workspace holding it. */
const MAX_DEPTH = 6;

/**
 * The workspace `dir` is inside, when it is inside one and is not its root.
 * Stops at a repository boundary, so a package is never attached to a
 * workspace that merely happens to contain its checkout.
 */
export function workspaceAround(dir: string): Workspace | null {
  // A package that is its own repository is its own app.
  if (existsSync(join(dir, ".git"))) return null;
  let current = dir;
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
    if (declaresWorkspace(current)) {
      return {
        root: current,
        manager: managerOf(current),
        yarnBerry: existsSync(join(current, ".yarnrc.yml")),
        turbo: existsSync(join(current, "turbo.json")),
      };
    }
    if (existsSync(join(current, ".git"))) return null;
  }
  return null;
}

function declaresWorkspace(dir: string): boolean {
  if (existsSync(join(dir, "pnpm-workspace.yaml"))) return true;
  const pkg = readJson(join(dir, "package.json"));
  const workspaces = pkg?.["workspaces"];
  return (
    Array.isArray(workspaces) ||
    (typeof workspaces === "object" &&
      workspaces !== null &&
      Array.isArray((workspaces as { packages?: unknown }).packages))
  );
}

/** By the lockfile the root keeps, which is what the build installs from. */
export function managerOf(root: string): PackageManager {
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock"))) {
    return "bun";
  }
  if (existsSync(join(root, "yarn.lock"))) return "yarn";
  return "npm";
}

/** What a Dockerfile Cira writes needs to know about the package. */
export interface WorkspacePackage {
  /** Its path from the workspace root, with forward slashes. */
  path: string;
  /** Its `name` in package.json, which the package managers filter by. */
  name: string | null;
  hasBuild: boolean;
  hasStart: boolean;
  /** The Node major the repository pins, when it pins one. */
  nodeMajor: number | null;
}

export function readWorkspacePackage(
  workspace: Workspace,
  dir: string,
): WorkspacePackage {
  const pkg = readJson(join(dir, "package.json"));
  const scripts = (pkg?.["scripts"] ?? {}) as Record<string, unknown>;
  return {
    path: relative(workspace.root, dir).replaceAll("\\", "/"),
    name: typeof pkg?.["name"] === "string" ? pkg["name"] : null,
    hasBuild: typeof scripts["build"] === "string",
    hasStart: typeof scripts["start"] === "string",
    nodeMajor: nodeMajorOf(workspace.root, dir),
  };
}

/** `.nvmrc`, `.node-version`, or a plain `engines.node`, nearest first. */
function nodeMajorOf(root: string, dir: string): number | null {
  for (const at of [dir, root]) {
    for (const file of [".nvmrc", ".node-version"]) {
      const text = readText(join(at, file));
      const major = text === null ? null : /^\s*v?(\d{2})\b/.exec(text)?.[1];
      if (major !== undefined && major !== null) return Number(major);
    }
    const engines = readJson(join(at, "package.json"))?.["engines"] as
      { node?: unknown } | undefined;
    const range = typeof engines?.node === "string" ? engines.node : null;
    const major = range === null ? null : /(\d{2})/.exec(range)?.[1];
    if (major !== undefined && major !== null) return Number(major);
  }
  return null;
}

/** The Node Cira builds with when the repository does not say. */
const DEFAULT_NODE = 22;

/**
 * A Dockerfile that builds one package of a workspace, from the workspace's
 * root. Browser-public variables arrive as build arguments, the same way a
 * Dockerfile the repository wrote receives them.
 */
export function workspaceDockerfile(args: {
  workspace: Workspace;
  pkg: WorkspacePackage;
  publicNames: readonly string[];
}): string {
  const { workspace, pkg } = args;
  const node =
    pkg.nodeMajor !== null && pkg.nodeMajor >= 18 ? pkg.nodeMajor : DEFAULT_NODE;

  const build = workspaceBuildCommand(workspace, pkg);

  const publics = args.publicNames.flatMap((name) => [
    `ARG ${name}`,
    `ENV ${name}=$${name}`,
  ]);

  return [
    `# Written by Cira for ${pkg.path}, which lives in a ${workspace.manager} workspace`,
    "# and needs the whole workspace to build. It is part of this upload only.",
    workspace.manager === "bun" ? "FROM oven/bun:1" : `FROM node:${node}-slim`,
    "WORKDIR /workspace",
    "ENV NEXT_TELEMETRY_DISABLED=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0",
    ...publics,
    "COPY . .",
    ...(workspace.manager === "bun" ? [] : ["RUN corepack enable"]),
    `RUN ${installCommand(workspace.manager, workspace.yarnBerry)}`,
    ...(build === null ? [] : [`RUN ${build}`]),
    "ENV NODE_ENV=production",
    `WORKDIR /workspace/${pkg.path}`,
    `CMD ["sh", "-c", "${RUN[workspace.manager]} start"]`,
    "",
  ].join("\n");
}

/**
 * Building one package of a workspace, from its root. Null when the package
 * has no build script.
 */
export function workspaceBuildCommand(
  workspace: Workspace,
  pkg: WorkspacePackage,
): string | null {
  const target = pkg.name ?? `./${pkg.path}`;
  // Turbo builds the package after what it depends on, which is exactly what
  // a package using `packages/ui` needs. Without it, each manager's own way of
  // saying the same; npm has none, and builds the package alone.
  return !pkg.hasBuild
    ? null
    : workspace.turbo
      ? `${TURBO[workspace.manager]} run build --filter=${quote(target)}`
      : workspace.manager === "pnpm"
        ? `pnpm --filter ${quote(`${target}...`)} run build`
        : workspace.manager === "yarn"
          ? pkg.name === null
            ? `cd ${quote(pkg.path)} && yarn run build`
            : `yarn workspace ${quote(pkg.name)} run build`
          : workspace.manager === "bun"
            ? `cd ${quote(pkg.path)} && bun run build`
            : `npm run build --workspace=${quote(pkg.path)}`;
}

/** Installing exactly what the lockfile says, as each manager does it. */
export function installCommand(manager: PackageManager, yarnBerry: boolean): string {
  switch (manager) {
    case "pnpm":
      return "pnpm install --frozen-lockfile";
    case "yarn":
      return yarnBerry ? "yarn install --immutable" : "yarn install --frozen-lockfile";
    case "bun":
      return "bun install --frozen-lockfile";
    case "npm":
      return "npm ci";
  }
}

/** Running one of the package's scripts, as each manager does it. */
export const RUN: Record<PackageManager, string> = {
  pnpm: "pnpm",
  yarn: "yarn",
  npm: "npm run",
  bun: "bun run",
};

/** The workspace's own turbo, as each manager runs an installed binary. */
const TURBO: Record<PackageManager, string> = {
  pnpm: "pnpm exec turbo",
  yarn: "yarn turbo",
  npm: "npx --no-install turbo",
  bun: "bunx turbo",
};

/** A shell word, quoted only when it has to be. */
function quote(word: string): string {
  return /^[A-Za-z0-9@._/+=:-]+$/.test(word)
    ? word
    : `'${word.replaceAll("'", "'\\''")}'`;
}

function readJson(path: string): Record<string, unknown> | null {
  const text = readText(path);
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readText(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
}
