import type { Limits } from "./limits.js";
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
}

/** What a repository says about how it runs. */
export interface ProcessDeclarations {
  /**
   * Whether the repository declares a web process. Null when it says nothing
   * either way, which is the ordinary app, and is read as yes.
   */
  web: boolean | null;
  processes: DeclaredProcess[];
}

/**
 * Procfile names that are not processes of their own: `web` is the app, and
 * `release` runs once per deploy, which Cira does not do yet.
 */
const NOT_A_PROCESS = new Set(["web", "release"]);

/**
 * A Procfile: `name: command`, one per line. `web` is the web process; every
 * other line runs all the time, which is what a Procfile means by a process.
 */
export function readProcfile(text: string): ProcessDeclarations {
  const processes: DeclaredProcess[] = [];
  let web = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.+)$/.exec(line);
    if (match === null) continue;
    const [, name, command] = match as unknown as [string, string, string];
    if (name === "web") web = true;
    if (NOT_A_PROCESS.has(name)) continue;
    processes.push({
      name: processName(name),
      kind: "worker",
      command: command.trim(),
      schedule: null,
      source: "Procfile",
    });
  }
  return { web, processes };
}

/**
 * A `fly.toml`: `[processes]` names each process group and its command, and
 * `[http_service]` (or `[[services]]`) says which of them take web traffic.
 * Those are the web process; the rest run all the time.
 *
 * Only the handful of keys this needs are read, with a reader that
 * understands exactly as much TOML as they are written in, rather than a
 * general parser shipped inside the CLI for three keys.
 */
export function readFlyToml(text: string): ProcessDeclarations & {
  /** The Dockerfile `[build]` names, relative to the fly.toml. */
  dockerfile: string | null;
} {
  const tables = readTomlTables(text);
  const commands = tables.get("processes") ?? new Map<string, TomlValue>();
  const dockerfile = asString(tables.get("build")?.get("dockerfile"));

  const serving = new Set<string>();
  for (const [table, values] of tables) {
    if (table !== "http_service" && table !== "services") continue;
    const listed = values.get("processes");
    if (Array.isArray(listed)) for (const p of listed) serving.add(p);
    else if (commands.size === 0 || listed === undefined) serving.add("app");
  }

  if (commands.size === 0) {
    return { web: serving.size > 0 ? true : null, processes: [], dockerfile };
  }

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
    });
  }
  return { web: serving.size > 0, processes, dockerfile };
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
  for (const declaration of found) {
    if (declaration.web !== null) web = web === true ? true : declaration.web;
    for (const process of declaration.processes) {
      if (!byName.has(process.name)) byName.set(process.name, process);
    }
  }
  return { web, processes: [...byName.values()] };
}

type TomlValue = string | string[] | number | boolean;

/**
 * Just enough TOML: `[table]` and `[[table]]` headers, and `key = value` where
 * the value is a string, a list of strings, a number or a boolean. Anything
 * else is skipped rather than guessed at.
 */
function readTomlTables(text: string): Map<string, Map<string, TomlValue>> {
  const tables = new Map<string, Map<string, TomlValue>>();
  let current = "";
  tables.set(current, new Map());
  for (const raw of text.split("\n")) {
    const line = stripComment(raw).trim();
    if (line === "") continue;
    const header = /^\[\[?\s*([A-Za-z0-9_.-]+)\s*\]\]?$/.exec(line);
    if (header !== null) {
      current = header[1]!;
      if (!tables.has(current)) tables.set(current, new Map());
      continue;
    }
    const pair = /^([A-Za-z0-9_-]+|"[^"]+")\s*=\s*(.+)$/.exec(line);
    if (pair === null) continue;
    const key = pair[1]!.replace(/^"|"$/g, "");
    const value = tomlValue(pair[2]!.trim());
    if (value !== null) tables.get(current)!.set(key, value);
  }
  return tables;
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
 * kind and source from the repository, keeps a timetable a person chose over
 * the one the repository suggests, and keeps whether it was switched on -
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
