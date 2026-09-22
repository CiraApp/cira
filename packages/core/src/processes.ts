import type { ProcessState } from "./deployment-provider.js";
import { DEFAULT_LIMITS, type Limits } from "./limits.js";
import { monthlyCost } from "./pricing.js";
import {
  describeSchedule,
  parseSchedule,
  shortestGapMinutes,
  type Schedule,
} from "./schedule.js";

/**
 * Processes: everything an app runs besides answering web requests.
 *
 * A **worker** runs all the time with no web port - a queue consumer, or a
 * process keeping its own timetable, like Wave's `arq`. A **scheduled** run is
 * a command run to completion on a timetable. Both run from the same image as
 * the app, started with a different command, so they can never drift from it.
 *
 * Nobody writes these down for Cira. A repository that already says how it
 * runs - a Procfile, a `fly.toml`, a GitHub Actions schedule - is read for
 * them here, as plain text in and declarations out, so the rules can be tested
 * without a repository and the CLI only has to find the files.
 */

export type ProcessKind = "worker" | "scheduled";

/** Where a process was found, so a page can say why Cira thinks it exists. */
export type ProcessSource = "Procfile" | "fly.toml" | "GitHub Actions";

export interface DeclaredProcess {
  /** Unique within the app; names it on the page and in Google. */
  name: string;
  kind: ProcessKind;
  command: string;
  /** A timetable found beside it, as written, or null for a person to set. */
  schedule: string | null;
  source: ProcessSource;
  /**
   * The memory the repository gives it, in MiB, as written - before Cira
   * rounds it to a size it offers (see `settleMemory`). Null when it does not
   * say, which most repositories do not.
   */
  memoryMiB: number | null;
}

/** What a repository says about how it runs. */
export interface ProcessDeclarations {
  /**
   * Whether the repository declares a web process. Null when it says nothing
   * either way, which is the ordinary app, and is read as yes.
   */
  web: boolean | null;
  processes: DeclaredProcess[];
  /** Memory the file gives the web process, in MiB, when it says. */
  webMemoryMiB?: number | null;
  /**
   * What runs once per deploy, before the new version takes traffic: a
   * Procfile's `release:` line or fly.toml's `release_command`, which is
   * almost always the database migration.
   */
  release?: string | null;
}

/**
 * Procfile names that are not processes of their own: `web` is the app, and
 * `release` runs once per deploy, before the new version takes traffic.
 */
const NOT_A_PROCESS = new Set(["web", "release"]);

/**
 * A Procfile: `name: command`, one per line. `web` is the web process; every
 * other line runs all the time, which is what a Procfile means by a process.
 */
export function readProcfile(text: string): ProcessDeclarations {
  const processes: DeclaredProcess[] = [];
  let web = false;
  let release: string | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.+)$/.exec(line);
    if (match === null) continue;
    const [, name, command] = match as unknown as [string, string, string];
    if (name === "web") web = true;
    if (name === "release") release = command.trim();
    if (NOT_A_PROCESS.has(name)) continue;
    processes.push({
      name: processName(name),
      kind: "worker",
      command: command.trim(),
      schedule: null,
      source: "Procfile",
      memoryMiB: null,
    });
  }
  return { web, processes, release };
}

/**
 * A `fly.toml`: `[processes]` names each process group and its command, and
 * `[http_service]` (or `[[services]]`) says which of them take web traffic.
 * Those are the web process; the rest run all the time. `[[vm]]` says how
 * much memory each is given - Wave gives its ffmpeg worker twice the API's -
 * either for the groups it lists or, listing none, for all of them.
 *
 * Only the handful of keys this needs are read, with a reader that
 * understands exactly as much TOML as they are written in, rather than a
 * general parser shipped inside the CLI for three keys.
 */
export function readFlyToml(text: string): ProcessDeclarations & {
  /** The Dockerfile `[build]` names, relative to the fly.toml. */
  dockerfile: string | null;
} {
  const entries = readToml(text);
  const tables = new Map<string, Map<string, TomlValue>>();
  for (const [table, values] of entries) {
    tables.set(table, new Map([...(tables.get(table) ?? []), ...values]));
  }
  const commands = tables.get("processes") ?? new Map<string, TomlValue>();
  const dockerfile = asString(tables.get("build")?.get("dockerfile"));
  const release = asString(tables.get("deploy")?.get("release_command"));

  const serving = new Set<string>();
  for (const [table, values] of entries) {
    if (table !== "http_service" && table !== "services") continue;
    const listed = values.get("processes");
    if (Array.isArray(listed)) for (const p of listed) serving.add(p);
    else if (commands.size === 0 || listed === undefined) serving.add("app");
  }

  // `[[compute]]` is the newer name for the same table.
  const vms = entries.filter(([table]) => table === "vm" || table === "compute");
  const general = vms.find(([, v]) => !Array.isArray(v.get("processes")));
  const memoryOf = (group: string): number | null => {
    const listed = vms.find(([, v]) => {
      const groups = v.get("processes");
      return Array.isArray(groups) && groups.includes(group);
    });
    return flyMemory((listed ?? general)?.[1]);
  };

  if (commands.size === 0) {
    return {
      web: serving.size > 0 ? true : null,
      processes: [],
      dockerfile,
      webMemoryMiB: flyMemory(general?.[1]),
      release,
    };
  }
  const webGroup = [...serving][0];

  const processes: DeclaredProcess[] = [];
  for (const [name, value] of commands) {
    const command = asString(value);
    if (command === null || serving.has(name)) continue;
    processes.push({
      name: processName(name),
      kind: "worker",
      command,
      schedule: null,
      source: "fly.toml",
      memoryMiB: memoryOf(name),
    });
  }
  return {
    web: serving.size > 0,
    processes,
    dockerfile,
    webMemoryMiB: webGroup === undefined ? null : memoryOf(webGroup),
    release,
  };
}

/**
 * Fly's machine sizes, by the memory each comes with when `memory` is not
 * also given.
 */
const FLY_SIZES: Record<string, number> = {
  "shared-cpu-1x": 256,
  "shared-cpu-2x": 512,
  "shared-cpu-4x": 1024,
  "shared-cpu-8x": 2048,
  "performance-1x": 2048,
  "performance-2x": 4096,
  "performance-4x": 8192,
  "performance-8x": 16384,
  "performance-16x": 32768,
};

/** A `[[vm]]` table's memory: `memory`, `memory_mb`, or its `size`'s. */
function flyMemory(vm: Map<string, TomlValue> | undefined): number | null {
  if (vm === undefined) return null;
  const memory = vm.get("memory");
  if (typeof memory === "number") return memory;
  if (typeof memory === "string") {
    const read = readMemory(memory);
    if (read !== null) return read;
  }
  const mb = vm.get("memory_mb");
  if (typeof mb === "number") return mb;
  const size = vm.get("size");
  return typeof size === "string" ? (FLY_SIZES[size.toLowerCase()] ?? null) : null;
}

/** "1gb", "1024mb", "2 GB", "512": MiB, or null for anything else. */
export function readMemory(text: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(gb|gib|g|mb|mib|m)?\s*$/i.exec(text);
  if (match === null) return null;
  const amount = Number(match[1]);
  const unit = (match[2] ?? "mb").toLowerCase();
  return Math.round(unit.startsWith("g") ? amount * 1024 : amount);
}

/**
 * Heroku's dyno sizes, by memory. A repository with a Procfile often has an
 * `app.json` whose `formation` says which size each process runs at.
 */
const HEROKU_SIZES: Record<string, number> = {
  eco: 512,
  basic: 512,
  "1x": 512,
  "standard-1x": 512,
  "2x": 1024,
  "standard-2x": 1024,
  "private-s": 1024,
  "shield-s": 1024,
  pm: 2560,
  "performance-m": 2560,
  "private-m": 2560,
  "shield-m": 2560,
  pl: 14336,
  "performance-l": 14336,
  "private-l": 14336,
  "shield-l": 14336,
};

/**
 * An `app.json`'s `formation`: each process's memory by name, from its dyno
 * size. It names the processes a Procfile runs, so it only adds a size to
 * processes found elsewhere.
 */
export function readAppJsonSizes(text: string): Map<string, number> {
  const sizes = new Map<string, number>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return sizes;
  }
  const formation =
    typeof parsed === "object" && parsed !== null
      ? (parsed as { formation?: unknown }).formation
      : undefined;
  if (typeof formation !== "object" || formation === null) return sizes;
  for (const [name, value] of Object.entries(formation)) {
    const size =
      typeof value === "object" && value !== null
        ? (value as { size?: unknown }).size
        : undefined;
    const memory =
      typeof size === "string" ? HEROKU_SIZES[size.toLowerCase()] : undefined;
    if (memory !== undefined) sizes.set(processName(name), memory);
  }
  return sizes;
}

/**
 * The memory Cira gives a process: what its repository asked for, rounded up
 * to a size Cira offers, or the default when it did not say. `capped` is set
 * when it asked for more than the largest, so whoever deployed it is told.
 */
export function settleMemory(
  askedMiB: number | null,
  limits: Limits,
): { memoryMiB: number; capped: boolean } {
  const { memoryChoicesMiB: choices, defaultMemoryMiB } = limits.processes;
  if (askedMiB === null || !Number.isFinite(askedMiB) || askedMiB <= 0) {
    return { memoryMiB: defaultMemoryMiB, capped: false };
  }
  const largest = choices[choices.length - 1]!;
  const fits = choices.find((c) => c >= askedMiB);
  return { memoryMiB: fits ?? largest, capped: fits === undefined };
}

/** Memory in the words a page uses: "512 MB", "1 GB". */
export function describeMemory(mib: number): string {
  return mib >= 1024 && mib % 1024 === 0 ? `${mib / 1024} GB` : `${mib} MB`;
}

/**
 * What a worker costs a month while it is on, in whole dollars rounded to the
 * nearest five: one always-running instance with one CPU and this much
 * memory, at the rates in pricing.ts. An estimate to put beside a switch, not
 * a bill.
 */
export function workerMonthlyDollars(memoryMiB: number): number {
  const dollars = monthlyCost({ cpu: DEFAULT_LIMITS.app.cpu, memoryMiB });
  return Math.max(5, Math.round(dollars / 5) * 5);
}

/**
 * A GitHub Actions workflow that runs on a timetable and runs a script from
 * the repository: the timetable, and the last step that invokes a file in
 * the repository, as a scheduled run. Setup steps - installing, checking
 * out - are not the job, so only a step naming a script counts, and a
 * workflow with none is not proposed at all.
 *
 * Read line by line rather than as YAML: a timetable is always a `cron:` line
 * under `schedule:`, and a step is a `run:` line, and a partial reading that
 * finds nothing is the right answer for anything unusual.
 */
export function readScheduledWorkflow(
  name: string,
  text: string,
): DeclaredProcess | null {
  if (!/^\s*schedule\s*:/m.test(text)) return null;
  const crons = [
    ...text.matchAll(/^\s*-\s*cron\s*:\s*['"]?([^'"#\n]+?)['"]?\s*(?:#.*)?$/gm),
  ]
    .map((m) => m[1]!.trim())
    .filter((c) => parseSchedule(c).ok);
  if (crons.length === 0) return null;

  const runs = [...text.matchAll(/^\s*(?:-\s*)?run\s*:\s*(?!\||>)(.+)$/gm)]
    .map((m) => m[1]!.trim().replace(/^['"]|['"]$/g, ""))
    .filter((cmd) => SCRIPT.test(cmd));
  const command = runs.at(-1);
  if (command === undefined) return null;

  return {
    name: processName(name.replace(/\.ya?ml$/i, "")),
    kind: "scheduled",
    command,
    // More than one timetable is one run on the first; a person can widen it.
    schedule: crons[0]!,
    source: "GitHub Actions",
    // A GitHub runner's memory says nothing about what the script needs.
    memoryMiB: null,
  };
}

/** A step that runs a file from the repository, as opposed to setting up. */
const SCRIPT =
  /^(?:(?:python3?|node|ruby|bash|sh|php|bun|deno run|uv run|poetry run|npx tsx|tsx)\s+)?\.?\/?[\w./-]+\.(?:py|js|mjs|cjs|ts|rb|sh|php)\b|^(?:npm|pnpm|yarn) run [\w:-]+$/;

/**
 * A name Cloud Run and Cloud Scheduler both accept, and a person can read:
 * lowercase letters, digits and hyphens, starting with a letter.
 */
export function processName(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/, "");
  if (cleaned === "") return "process";
  return /^[a-z]/.test(cleaned) ? cleaned : `p-${cleaned}`.slice(0, 30);
}

/**
 * Everything a repository declares, from every file that declares it, with
 * one entry per name. A Procfile outranks fly.toml, which outranks a workflow:
 * the more specific a file is about running the app, the more it is believed.
 */
export function mergeDeclarations(
  found: readonly ProcessDeclarations[],
): ProcessDeclarations {
  const byName = new Map<string, DeclaredProcess>();
  let web: boolean | null = null;
  let webMemoryMiB: number | null = null;
  let release: string | null = null;
  for (const declaration of found) {
    if (declaration.web !== null) web = web === true ? true : declaration.web;
    webMemoryMiB ??= declaration.webMemoryMiB ?? null;
    release ??= declaration.release ?? null;
    for (const process of declaration.processes) {
      if (!byName.has(process.name)) byName.set(process.name, process);
    }
  }
  return { web, processes: [...byName.values()], webMemoryMiB, release };
}

type TomlValue = string | string[] | number | boolean;

/**
 * Just enough TOML: `[table]` and `[[table]]` headers, and `key = value` where
 * the value is a string, a list of strings, a number or a boolean. Anything
 * else is skipped rather than guessed at. Each header starts an entry of its
 * own, in order, so the several `[[vm]]` tables a file can have stay apart.
 */
function readToml(text: string): Array<[string, Map<string, TomlValue>]> {
  const entries: Array<[string, Map<string, TomlValue>]> = [["", new Map()]];
  for (const raw of text.split("\n")) {
    const line = stripComment(raw).trim();
    if (line === "") continue;
    const header = /^\[\[?\s*([A-Za-z0-9_.-]+)\s*\]\]?$/.exec(line);
    if (header !== null) {
      entries.push([header[1]!, new Map()]);
      continue;
    }
    const pair = /^([A-Za-z0-9_-]+|"[^"]+")\s*=\s*(.+)$/.exec(line);
    if (pair === null) continue;
    const key = pair[1]!.replace(/^"|"$/g, "");
    const value = tomlValue(pair[2]!.trim());
    if (value !== null) entries.at(-1)![1].set(key, value);
  }
  return entries;
}

function tomlValue(text: string): TomlValue | null {
  const string = /^"((?:[^"\\]|\\.)*)"$|^'([^']*)'$/.exec(text);
  if (string !== null) {
    return string[1] !== undefined ? string[1].replace(/\\(["\\])/g, "$1") : string[2]!;
  }
  if (text.startsWith("[") && text.endsWith("]")) {
    return [...text.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map(
      (m) => m[1] ?? m[2] ?? "",
    );
  }
  if (text === "true" || text === "false") return text === "true";
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return null;
}

/** A `#` outside a string starts a comment. */
function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote !== null) {
      if (c === "\\" && quote === '"') i += 1;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "#") return line.slice(0, i);
  }
  return line;
}

function asString(value: TomlValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * A timetable someone wants a run to keep, checked against what Cira will
 * run, with how long each run may take.
 *
 * The timeout is what stops one run from overlapping the next. Cloud Scheduler
 * starts a run on time whether or not the last is finished, and Cira is
 * deliberately not in that loop, so the guarantee is made here instead: a run
 * is always stopped a minute before its next one could start. A timetable too
 * tight to leave any room is refused rather than allowed to overlap.
 */
export function checkTimetable(
  expression: string,
  requestedTimeoutMinutes: number | null,
  limits: Limits,
  now: Date,
):
  | {
      ok: true;
      schedule: Schedule;
      words: string;
      timeoutMinutes: number;
      gapMinutes: number;
    }
  | { ok: false; message: string } {
  const parsed = parseSchedule(expression);
  if (!parsed.ok) return { ok: false, message: parsed.error };

  const gap = shortestGapMinutes(parsed.schedule, now);
  const { minIntervalMinutes, defaultTimeoutMinutes, maxTimeoutMinutes } =
    limits.processes;
  if (gap < minIntervalMinutes) {
    return {
      ok: false,
      message: `That runs every ${gap === 1 ? "minute" : `${gap} minutes`}. Scheduled runs can be at most every ${minIntervalMinutes} minutes; anything more often belongs in a worker.`,
    };
  }

  const requested = requestedTimeoutMinutes ?? defaultTimeoutMinutes;
  if (!Number.isInteger(requested) || requested < 1 || requested > maxTimeoutMinutes) {
    return {
      ok: false,
      message: `A run can be given between 1 and ${maxTimeoutMinutes} minutes.`,
    };
  }

  return {
    ok: true,
    schedule: parsed.schedule,
    words: describeSchedule(parsed.schedule),
    // Always stopped a minute before the next could begin.
    timeoutMinutes: Math.min(requested, gap - 1),
    gapMinutes: gap,
  };
}

/** A process as Cira keeps it, with the decisions people made about it. */
export interface StoredProcess {
  id: string;
  name: string;
  kind: ProcessKind;
  command: string;
  serviceSlug: string;
  schedule: string | null;
  /** When a person chose the timetable; null when it came from the repository. */
  scheduleSetAt: Date | null;
  timeoutMinutes: number | null;
  /** One of the offered sizes, or null for the default. */
  memoryMiB: number | null;
  /** When a person chose the memory; null when it came from the repository. */
  memorySetAt: Date | null;
  enabled: boolean;
  source: string;
}

/** A declared process, and which of the app's images it runs in. */
export type DeployedProcess = DeclaredProcess & { service: string };

/**
 * What a deploy does to the processes already on record.
 *
 * The repository is the truth about what exists and how it runs; people are
 * the truth about whether it runs and when. So a redeploy takes the command,
 * kind and source from the repository, keeps a timetable or memory a person
 * chose over what the repository suggests, and keeps whether it was switched on -
 * unless it changed kind, because a scheduled run turning into a worker costs
 * money every hour and nobody agreed to that. What the repository no longer
 * mentions is removed.
 */
export function planProcesses(
  existing: readonly StoredProcess[],
  declared: readonly DeployedProcess[],
): {
  create: DeployedProcess[];
  update: Array<{
    id: string;
    process: DeployedProcess;
    schedule: string | null;
    memoryMiB: number | null;
    enabled: boolean;
  }>;
  remove: string[];
} {
  const byName = new Map(existing.map((p) => [p.name, p]));
  const create: DeployedProcess[] = [];
  const update: Array<{
    id: string;
    process: DeployedProcess;
    schedule: string | null;
    memoryMiB: number | null;
    enabled: boolean;
  }> = [];

  for (const process of declared) {
    const stored = byName.get(process.name);
    if (stored === undefined) {
      create.push(process);
      continue;
    }
    const sameKind = stored.kind === process.kind;
    update.push({
      id: stored.id,
      process,
      schedule:
        process.kind === "worker"
          ? null
          : stored.scheduleSetAt !== null && sameKind
            ? stored.schedule
            : process.schedule,
      memoryMiB: stored.memorySetAt !== null ? stored.memoryMiB : process.memoryMiB,
      enabled: sameKind && stored.enabled,
    });
  }

  const kept = new Set(declared.map((p) => p.name));
  const remove = existing.filter((p) => !kept.has(p.name)).map((p) => p.id);
  return { create, update, remove };
}

/**
 * How long each run of a scheduled process may take, in seconds: what was
 * asked for, held under the gap to its next run. A run with no timetable yet
 * is given the default, since it can only be started by hand.
 */
export function runTimeoutSeconds(
  process: Pick<StoredProcess, "schedule" | "timeoutMinutes">,
  limits: Limits,
  now: Date,
): number {
  const fallback =
    (process.timeoutMinutes ?? limits.processes.defaultTimeoutMinutes) * 60;
  if (process.schedule === null) return fallback;
  const checked = checkTimetable(process.schedule, process.timeoutMinutes, limits, now);
  return checked.ok ? checked.timeoutMinutes * 60 : fallback;
}

/** How often a worker has been stopping, when it has been. */
export type WorkerCrashes = NonNullable<
  Extract<ProcessState, { kind: "worker" }>["crashes"]
>;

/**
 * "12 times in the last hour, with code 3": the count first, since that is
 * what makes it a crash loop. Put the other way round the two numbers ran
 * together, as "exited with code 3 12 times".
 */
export function crashCount(crashes: WorkerCrashes): string {
  const times = `${crashes.count}${crashes.more ? " or more" : ""} times in the last hour`;
  return crashes.exitCode === null ? times : `${times}, with code ${crashes.exitCode}`;
}
