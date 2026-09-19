import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, normalize, relative } from "node:path";
import {
  mergeDeclarations,
  readFlyToml,
  readProcfile,
  readScheduledWorkflow,
  type DeclaredProcess,
  type ProcessDeclarations,
} from "@cira/core/processes";

/**
 * Finding what an app runs besides serving requests, in the files the
 * repository already has. The reading itself is core's; this only knows where
 * such files live and which of the app's parts each one is about.
 */

export interface FoundProcess extends DeclaredProcess {
  /** The part whose image it runs in. */
  service: string;
}

export interface FoundProcesses {
  /** Whether the repository names a web process. Null when it does not say. */
  web: boolean | null;
  processes: FoundProcess[];
}

interface Part {
  slug: string;
  sourcePath: string;
  dockerfile: string | null;
}

/** Where a fly.toml is conventionally kept, besides beside the code. */
const FLY_DIRS = ["", "infra", "deploy", "ops", ".fly"];

export function discoverProcesses(root: string, parts: readonly Part[]): FoundProcesses {
  const only = parts.length === 1 ? parts[0]! : null;
  const found: Array<ProcessDeclarations & { service: string | null }> = [];

  // A Procfile beside a part is about that part; one at the root is about the
  // app when the app is one thing.
  for (const part of parts) {
    const text = read(join(root, part.sourcePath, "Procfile"));
    if (text !== null) found.push({ ...readProcfile(text), service: part.slug });
  }
  if (only === null || only.sourcePath !== "") {
    const text = read(join(root, "Procfile"));
    if (text !== null) found.push({ ...readProcfile(text), service: only?.slug ?? null });
  }

  // A fly.toml says which Dockerfile it builds, which says which part it is.
  const flyDirs = new Set([...FLY_DIRS, ...parts.map((p) => p.sourcePath)]);
  for (const dir of flyDirs) {
    const text = read(join(root, dir, "fly.toml"));
    if (text === null) continue;
    const fly = readFlyToml(text);
    const built =
      fly.dockerfile === null
        ? null
        : normalize(relative(root, join(root, dir, fly.dockerfile))).replaceAll(
            "\\",
            "/",
          );
    const part =
      parts.find((p) => p.dockerfile !== null && p.dockerfile === built) ??
      parts.find((p) => p.sourcePath === dir) ??
      only;
    found.push({ ...fly, service: part?.slug ?? null });
  }

  // A scheduled workflow runs from the repository root; inside the image the
  // working directory is the part's own, so a path into that part is made
  // relative to it.
  const workflows = join(root, ".github", "workflows");
  if (existsSync(workflows)) {
    for (const file of safeList(workflows)) {
      if (!/\.ya?ml$/i.test(file)) continue;
      const text = read(join(workflows, file));
      if (text === null) continue;
      const process = readScheduledWorkflow(file, text);
      if (process === null) continue;
      const part =
        parts.find(
          (p) => p.sourcePath !== "" && process.command.includes(`${p.sourcePath}/`),
        ) ?? only;
      if (part === null || part === undefined) continue;
      const command =
        part.sourcePath === ""
          ? process.command
          : process.command.replaceAll(`${part.sourcePath}/`, "");
      found.push({ web: null, processes: [{ ...process, command }], service: part.slug });
    }
  }

  // Declarations whose part could not be told are left out rather than run in
  // the wrong image.
  const usable = found.filter((f) => f.service !== null);
  const merged = mergeDeclarations(
    usable.map((f) => ({
      web: f.web,
      processes: f.processes.map((p) => ({ ...p, service: f.service! }) as FoundProcess),
    })),
  );

  return { web: merged.web, processes: merged.processes as FoundProcess[] };
}

function read(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}
