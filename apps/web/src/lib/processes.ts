import "server-only";

import { eq, inArray } from "drizzle-orm";
import { atomically, db, processes } from "@cira/db";
import {
  DEFAULT_LIMITS,
  describeSchedule,
  newId,
  nextRuns,
  parseSchedule,
  planProcesses,
  runTimeoutSeconds,
  type DeployedProcess,
  type ProcessSpec,
  type ProcessState,
  type StoredProcess,
} from "@cira/core";
import { deploymentProvider } from "@cira/deploy";

/**
 * An app's workers and scheduled runs, as Cira keeps them.
 *
 * Written at each deploy from what the repository declares, keeping what
 * people decided (see core's planProcesses), and read whenever the provider
 * needs to be told how they should be.
 */

export async function listProcesses(appId: string): Promise<StoredProcess[]> {
  const rows = await db().select().from(processes).where(eq(processes.appId, appId));
  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      command: row.command,
      serviceSlug: row.serviceSlug,
      schedule: row.schedule,
      scheduleSetAt: row.scheduleSetAt,
      timeoutMinutes: row.timeoutMinutes,
      memoryMiB: row.memoryMiB,
      memorySetAt: row.memorySetAt,
      enabled: row.enabled,
      source: row.source,
    }))
    .sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "worker" ? -1 : 1,
    );
}

/** Bring the record in line with what this deploy's repository declares. */
export async function recordProcesses(args: {
  appId: string;
  spaceId: string;
  declared: readonly DeployedProcess[];
}): Promise<StoredProcess[]> {
  const database = db();
  const plan = planProcesses(await listProcesses(args.appId), args.declared);
  const now = new Date();

  // One answer from the repository, so one write: a partial one would leave
  // a process removed from the page but not its replacement added.
  await atomically(database, (on) => [
    ...(plan.remove.length > 0
      ? [on.delete(processes).where(inArray(processes.id, plan.remove))]
      : []),
    ...plan.create.map((p) =>
      on.insert(processes).values({
        id: newId("process"),
        appId: args.appId,
        spaceId: args.spaceId,
        name: p.name,
        kind: p.kind,
        command: p.command,
        serviceSlug: p.service,
        schedule: p.schedule,
        memoryMiB: p.memoryMiB,
        source: p.source,
        enabled: false,
      }),
    ),
    ...plan.update.map((u) =>
      on
        .update(processes)
        .set({
          kind: u.process.kind,
          command: u.process.command,
          serviceSlug: u.process.service,
          source: u.process.source,
          schedule: u.schedule,
          memoryMiB: u.memoryMiB,
          enabled: u.enabled,
          updatedAt: now,
        })
        .where(eq(processes.id, u.id)),
    ),
  ]);

  return listProcesses(args.appId);
}

/** What the provider is told about each process. */
export function specsFor(
  stored: readonly StoredProcess[],
  now = new Date(),
): ProcessSpec[] {
  return stored.map((p) => ({
    name: p.name,
    kind: p.kind,
    command: p.command,
    service: p.serviceSlug,
    schedule: p.kind === "scheduled" ? p.schedule : null,
    timeoutSeconds: runTimeoutSeconds(p, DEFAULT_LIMITS, now),
    memoryMiB: p.memoryMiB ?? DEFAULT_LIMITS.processes.defaultMemoryMiB,
    // A scheduled run with no timetable has nothing to be on for.
    enabled: p.enabled && (p.kind === "worker" || p.schedule !== null),
  }));
}

/** One process, ready for the app page to draw. */
export interface ProcessView {
  name: string;
  kind: "worker" | "scheduled";
  /** Null for anyone who does not manage the app: how it runs is theirs to know. */
  command: string | null;
  source: string;
  enabled: boolean;
  schedule: string | null;
  /** The timetable in words, with its zone; null without one. */
  scheduleWords: string | null;
  nextRunAt: Date | null;
  /** What each run is actually given, after the gap to the next is allowed for. */
  timeoutMinutes: number;
  /** What someone asked for, to fill the editor; null for the default. */
  requestedTimeoutMinutes: number | null;
  /** MiB it is given: what Google reports when it could be asked, else the record's. */
  memoryMiB: number;
  /**
   * When it last ran out of memory, if that is its latest trouble: a worker
   * restarted for it lately, or a scheduled run whose last run was killed
   * for it. Null otherwise.
   */
  outOfMemoryAt: Date | null;
  /** A worker that keeps exiting on its own: how often in the last hour, and how. */
  crashes: { count: number; lastAt: Date; exitCode: number | null } | null;
  /** What Google reports, or null when it could not be asked. */
  state: ProcessState | null;
}

/**
 * An app's processes with what Google says about each, for its page and for
 * Ask Cira.
 *
 * Whether each is running, how its runs went and when it runs next is for
 * anyone who can open the app: troubleshooting "did last night's report go
 * out?" should not need an admin. The command is withheld unless `commands`
 * is set, from the one place both readers get it, so neither can forget to.
 *
 * Asking Google is one call per process, made while someone is looking -
 * the same bargain the deployment status makes. If it cannot be asked, the
 * page still lists what the app runs and says it could not check.
 */
export async function processesForPage(
  appId: string,
  handle: string | null,
  { commands }: { commands: boolean },
): Promise<ProcessView[]> {
  const stored = await listProcesses(appId);
  if (stored.length === 0) return [];

  let states: ProcessState[] | null = null;
  if (handle !== null) {
    try {
      states = await deploymentProvider().processStates(
        handle,
        stored.map((p) => ({ name: p.name, kind: p.kind })),
      );
    } catch {
      states = null;
    }
  }

  const now = new Date();
  return stored.map((p) => {
    const parsed = p.schedule === null ? null : parseSchedule(p.schedule);
    const schedule = parsed !== null && parsed.ok ? parsed.schedule : null;
    const state = states?.find((s) => s.name === p.name) ?? null;
    const last = state?.kind === "scheduled" ? state.runs[0] : undefined;
    return {
      name: p.name,
      kind: p.kind,
      command: commands ? p.command : null,
      source: p.source,
      enabled: p.enabled,
      schedule: p.schedule,
      scheduleWords: schedule === null ? null : describeSchedule(schedule),
      nextRunAt: schedule === null ? null : (nextRuns(schedule, now, 1)[0] ?? null),
      timeoutMinutes: Math.round(runTimeoutSeconds(p, DEFAULT_LIMITS, now) / 60),
      requestedTimeoutMinutes: p.timeoutMinutes,
      memoryMiB:
        state?.memoryMiB ?? p.memoryMiB ?? DEFAULT_LIMITS.processes.defaultMemoryMiB,
      outOfMemoryAt:
        state?.kind === "worker"
          ? state.outOfMemoryAt
          : last?.outOfMemory === true
            ? last.startedAt
            : null,
      crashes: state?.kind === "worker" ? state.crashes : null,
      state,
    };
  });
}
