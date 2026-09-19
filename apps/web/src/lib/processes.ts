import "server-only";

import { eq, inArray } from "drizzle-orm";
import { atomically, db, processes } from "@cira/db";
import {
  DEFAULT_LIMITS,
  newId,
  planProcesses,
  runTimeoutSeconds,
  type DeployedProcess,
  type ProcessSpec,
  type StoredProcess,
} from "@cira/core";

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
    // A scheduled run with no timetable has nothing to be on for.
    enabled: p.enabled && (p.kind === "worker" || p.schedule !== null),
  }));
}
