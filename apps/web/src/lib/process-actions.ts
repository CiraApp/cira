"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db, processes, spaces } from "@cira/db";
import {
  DEFAULT_LIMITS,
  checkProcessOn,
  checkTimetable,
  describeMemory,
  type StoredProcess,
} from "@cira/core";
import { ProcessError, deploymentProvider } from "@cira/deploy";
import { ForbiddenError, NotFoundError, requireAppManage } from "@/lib/authz";
import { planForSpace } from "@/lib/plan";
import { listProcesses, specsFor } from "@/lib/processes";
import { latestDeployment } from "@/lib/queries";

/**
 * What someone who manages an app can do to its workers and scheduled runs:
 * switch one on or off, give a scheduled run its timetable and time, give
 * either more or less memory, and run one now.
 *
 * Google is asked first and the record changed only once it has agreed, so a
 * refusal - Cloud Scheduler not yet switched on, a worker not yet created -
 * leaves the page telling the truth. None of this needs the app's secrets;
 * they were given to each process when the app was deployed.
 */

export type ProcessActionResult = { ok: true } | { ok: false; error: string };

export async function switchProcess(
  spaceSlug: string,
  appSlug: string,
  name: unknown,
  on: unknown,
): Promise<ProcessActionResult> {
  if (typeof on !== "boolean")
    return { ok: false, error: "That is not a change Cira knows." };
  if (!on) {
    return change(spaceSlug, appSlug, name, async (process) => ({
      ...process,
      enabled: false,
    }));
  }

  const found = await locate(spaceSlug, appSlug, name);
  if ("error" in found) return { ok: false, error: found.error };
  const { process, spaceId } = found;
  if (process.kind === "scheduled" && process.schedule === null) {
    return { ok: false, error: "Give it a timetable first, so it knows when to run." };
  }

  // Written down first, and only if there is room, in one step that no one
  // else's can interleave with; then asked of Google, and put back if Google
  // says no. Counting first and writing after let two people switching on at
  // the same moment both see room, and asking Google first could leave a
  // worker running - and billing - that Cira's records said was off.
  if (!process.enabled) {
    const plan = await planForSpace(spaceId);
    const most =
      process.kind === "worker"
        ? plan.limits.processes.workersPerSpace
        : plan.limits.processes.scheduledPerSpace;
    if (
      !(await claimRoom({ processId: process.id, spaceId, kind: process.kind, most }))
    ) {
      const room = checkProcessOn(process.kind, most, plan.limits);
      return { ok: false, error: room.ok ? "Try that again." : room.message };
    }
  }

  const [spec] = specsFor([{ ...process, enabled: true }]);
  try {
    await deploymentProvider().setProcess(found.handle, spec!);
  } catch (error) {
    if (!process.enabled) {
      await db()
        .update(processes)
        .set({ enabled: false, updatedAt: new Date() })
        .where(eq(processes.id, process.id));
    }
    return { ok: false, error: sentence(error) };
  }

  revalidatePath(`/${spaceSlug}/${appSlug}`);
  return { ok: true };
}

/**
 * Switch a process on in Cira's records if its space has room for one more
 * of its kind. Two statements in one transaction: the space's row is locked
 * first, so the second - which counts and writes - starts only once any other
 * switch in the same space has finished, and sees what it did.
 */
async function claimRoom(args: {
  processId: string;
  spaceId: string;
  kind: "worker" | "scheduled";
  most: number;
}): Promise<boolean> {
  const database = db();
  const lock = (on: typeof database) =>
    on
      .select({ id: spaces.id })
      .from(spaces)
      .where(eq(spaces.id, args.spaceId))
      .for("update");
  const claim = (on: typeof database) =>
    on
      .update(processes)
      .set({ enabled: true, updatedAt: new Date() })
      .where(
        and(
          eq(processes.id, args.processId),
          eq(processes.enabled, false),
          sql`(select count(*) from ${processes} as others
                where others.space_id = ${args.spaceId}
                  and others.kind = ${args.kind}
                  and others.enabled) < ${args.most}`,
        ),
      )
      .returning({ id: processes.id });

  const batching = database as unknown as {
    batch?: (statements: readonly unknown[]) => Promise<unknown[]>;
  };
  if (typeof batching.batch === "function") {
    const results = await batching.batch([lock(database), claim(database)]);
    return ((results[1] as unknown[] | undefined) ?? []).length === 1;
  }
  // An ordinary Postgres connection, as the tests use: a real transaction.
  const transacting = database as unknown as {
    transaction: <T>(run: (tx: typeof database) => Promise<T>) => Promise<T>;
  };
  return transacting.transaction(async (tx) => {
    await lock(tx);
    return (await claim(tx)).length === 1;
  });
}

export async function scheduleProcess(
  spaceSlug: string,
  appSlug: string,
  name: unknown,
  schedule: unknown,
  timeoutMinutes: unknown,
): Promise<ProcessActionResult> {
  if (typeof schedule !== "string" || schedule.length > 100) {
    return { ok: false, error: "That is not a timetable." };
  }
  if (timeoutMinutes !== null && typeof timeoutMinutes !== "number") {
    return { ok: false, error: "That is not a number of minutes." };
  }
  return change(spaceSlug, appSlug, name, async (process) => {
    if (process.kind !== "scheduled")
      return "A worker runs all the time; it has no timetable.";
    const checked = checkTimetable(schedule, timeoutMinutes, DEFAULT_LIMITS, new Date());
    if (!checked.ok) return checked.message;
    return {
      ...process,
      schedule: checked.schedule.expression,
      scheduleSetAt: new Date(),
      timeoutMinutes,
    };
  });
}

export async function setProcessMemory(
  spaceSlug: string,
  appSlug: string,
  name: unknown,
  memoryMiB: unknown,
): Promise<ProcessActionResult> {
  const choices = DEFAULT_LIMITS.processes.memoryChoicesMiB;
  if (typeof memoryMiB !== "number" || !choices.includes(memoryMiB)) {
    return {
      ok: false,
      error: `Choose one of ${choices.map(describeMemory).join(", ")}.`,
    };
  }
  return change(spaceSlug, appSlug, name, (process) =>
    Promise.resolve({ ...process, memoryMiB, memorySetAt: new Date() }),
  );
}

export async function runProcessNow(
  spaceSlug: string,
  appSlug: string,
  name: unknown,
): Promise<ProcessActionResult> {
  const found = await locate(spaceSlug, appSlug, name);
  if ("error" in found) return { ok: false, error: found.error };
  if (found.process.kind !== "scheduled") {
    return { ok: false, error: "Only a scheduled run can be started by hand." };
  }
  try {
    const run = await deploymentProvider().runProcess(found.handle, found.process.name);
    if (!run.started)
      return { ok: false, error: run.reason ?? "It could not be started." };
  } catch (error) {
    return { ok: false, error: sentence(error) };
  }
  revalidatePath(`/${spaceSlug}/${appSlug}`);
  return { ok: true };
}

/**
 * Apply a change: decide it, tell Google, and only then write it down. The
 * decision returns either the process as it should be, or why not.
 */
async function change(
  spaceSlug: string,
  appSlug: string,
  name: unknown,
  decide: (process: StoredProcess, spaceId: string) => Promise<StoredProcess | string>,
): Promise<ProcessActionResult> {
  const found = await locate(spaceSlug, appSlug, name);
  if ("error" in found) return { ok: false, error: found.error };

  const next = await decide(found.process, found.spaceId);
  if (typeof next === "string") return { ok: false, error: next };

  const [spec] = specsFor([next]);
  try {
    await deploymentProvider().setProcess(found.handle, spec!);
  } catch (error) {
    return { ok: false, error: sentence(error) };
  }

  await db()
    .update(processes)
    .set({
      enabled: next.enabled,
      schedule: next.schedule,
      scheduleSetAt: next.scheduleSetAt,
      timeoutMinutes: next.timeoutMinutes,
      memoryMiB: next.memoryMiB,
      memorySetAt: next.memorySetAt,
      updatedAt: new Date(),
    })
    .where(eq(processes.id, next.id));

  revalidatePath(`/${spaceSlug}/${appSlug}`);
  return { ok: true };
}

/** The process, the app's current deployment, and its space - or why not. */
async function locate(
  spaceSlug: string,
  appSlug: string,
  name: unknown,
): Promise<
  { process: StoredProcess; handle: string; spaceId: string } | { error: string }
> {
  let appId: string;
  let spaceId: string;
  try {
    const ctx = await requireAppManage(spaceSlug, appSlug);
    appId = ctx.app.id;
    spaceId = ctx.space.id;
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) {
      return { error: "No such app, or you do not manage it." };
    }
    throw error;
  }

  if (typeof name !== "string") return { error: "No such process on this app." };
  const process = (await listProcesses(appId)).find((p) => p.name === name);
  if (process === undefined) return { error: "No such process on this app." };

  const deployment = await latestDeployment(appId);
  if (deployment === null || deployment.provider !== "cloudrun") {
    return {
      error: "Deploy this app first; its processes are created when it is deployed.",
    };
  }
  return { process, handle: deployment.providerDeploymentId, spaceId };
}

function sentence(error: unknown): string {
  if (error instanceof ProcessError) return error.message;
  return "Google would not make that change right now.";
}
