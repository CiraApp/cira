import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { DEFAULT_LIMITS, newId, type ProcessSpec, type User } from "@cira/core";
import type * as CiraDb from "@cira/db";
import type * as CiraDeploy from "@cira/deploy";
import { migratedTestDatabase } from "../../../../packages/db/src/test-database.js";

/**
 * Switching an app's workers and scheduled runs on and off, giving them
 * timetables, and running them now - who may, within what limits, and in
 * which order Google and the record are told.
 */

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];
const hasDatabase = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== "";

let database: Awaited<ReturnType<typeof migratedTestDatabase>>;

vi.mock("@cira/db", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDb>();
  return { ...actual, db: () => database };
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

/** What Google was told, and whether it refuses. */
const told: ProcessSpec[] = [];
let googleRefuses = false;

vi.mock("@cira/deploy", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDeploy>();
  return {
    ...actual,
    deploymentProvider: () => ({
      setProcess: (_handle: string, spec: ProcessSpec) => {
        if (googleRefuses) {
          return Promise.reject(
            new actual.ProcessError(
              "Cloud Scheduler is not switched on for this Google Cloud project, so timetables cannot be set yet.",
              "scheduler-off",
              403,
            ),
          );
        }
        told.push(spec);
        return Promise.resolve();
      },
      runProcess: () => Promise.resolve({ started: true }),
    }),
  };
});

let signedIn: User | null = null;
vi.mock("@/lib/identity", () => ({
  getCurrentUser: () => Promise.resolve(signedIn),
  requireCurrentUser: () => Promise.resolve(signedIn),
}));

const owner: User = {
  id: newId("user"),
  name: "Owner",
  email: "o@p.test",
  createdAt: new Date(),
};
const user: User = {
  id: newId("user"),
  name: "User",
  email: "u@p.test",
  createdAt: new Date(),
};
const spaceId = newId("space");
const appId = newId("app");

describe.skipIf(!hasDatabase)("process actions", () => {
  beforeAll(async () => {
    database = await migratedTestDatabase(TEST_DATABASE_URL as string, "cira_proc");
    const { appAccess, apps, deployments, memberships, spaces, users } =
      await import("@cira/db");
    await database.insert(users).values([
      { id: owner.id, externalId: "p1", name: owner.name, email: owner.email },
      { id: user.id, externalId: "p2", name: user.name, email: user.email },
    ]);
    await database
      .insert(spaces)
      .values({ id: spaceId, name: "P", slug: "p", domain: "p.test" });
    await database.insert(memberships).values([
      { id: newId("membership"), userId: owner.id, spaceId, role: "member" },
      { id: newId("membership"), userId: user.id, spaceId, role: "member" },
    ]);
    await database.insert(apps).values({
      id: appId,
      spaceId,
      name: "Sync",
      slug: "sync",
      status: "live",
      ownerUserId: owner.id,
    });
    await database
      .insert(appAccess)
      .values({ id: newId("access"), appId, type: "user", targetId: user.id });
    await database.insert(deployments).values({
      id: newId("deployment"),
      appId,
      provider: "cloudrun",
      providerDeploymentId: "b1:p-sync-0000app1:t1:noweb",
      status: "live",
      servesWeb: false,
    });
  }, 60_000);

  afterAll(async () => {
    signedIn = null;
    await database?.end();
  });

  beforeEach(async () => {
    const { processes } = await import("@cira/db");
    told.length = 0;
    googleRefuses = false;
    signedIn = owner;
    await database.delete(processes);
    const row = (
      name: string,
      kind: "worker" | "scheduled",
      schedule: string | null,
    ) => ({
      id: newId("process"),
      appId,
      spaceId,
      name,
      kind,
      command: `run ${name}`,
      serviceSlug: "app",
      schedule,
      source: "Procfile",
    });
    await database
      .insert(processes)
      .values([
        row("report", "scheduled", null),
        row("worker-a", "worker", null),
        row("worker-b", "worker", null),
        row("worker-c", "worker", null),
      ]);
  });

  const stored = async (name: string) => {
    const { processes } = await import("@cira/db");
    const [row] = await database.select().from(processes).where(eq(processes.name, name));
    return row;
  };

  it("will not switch on a scheduled run with no timetable", async () => {
    const { switchProcess } = await import("./process-actions");
    const result = await switchProcess("p", "sync", "report", true);
    expect(result).toEqual({
      ok: false,
      error: "Give it a timetable first, so it knows when to run.",
    });
    expect(told).toHaveLength(0);
  });

  it("gives a timetable, holding each run under the gap, and then switches it on", async () => {
    const { scheduleProcess, switchProcess } = await import("./process-actions");

    expect(await scheduleProcess("p", "sync", "report", "*/5 * * * *", 30)).toEqual({
      ok: true,
    });
    expect(told.at(-1)).toMatchObject({ schedule: "*/5 * * * *", timeoutSeconds: 240 });
    expect(await stored("report")).toMatchObject({
      schedule: "*/5 * * * *",
      timeoutMinutes: 30,
    });
    expect((await stored("report"))?.scheduleSetAt).not.toBeNull();

    expect(await switchProcess("p", "sync", "report", true)).toEqual({ ok: true });
    expect(told.at(-1)).toMatchObject({ name: "report", enabled: true });
    expect((await stored("report"))?.enabled).toBe(true);
  });

  it("refuses a timetable it cannot run, before asking Google", async () => {
    const { scheduleProcess } = await import("./process-actions");
    const often = await scheduleProcess("p", "sync", "report", "* * * * *", null);
    expect(often.ok === false && often.error).toContain("belongs in a worker");
    const bad = await scheduleProcess("p", "sync", "report", "sometimes", null);
    expect(bad.ok).toBe(false);
    expect(told).toHaveLength(0);
  });

  it("keeps a space to its allowance of workers", async () => {
    const { switchProcess } = await import("./process-actions");
    const { workersPerSpace } = DEFAULT_LIMITS.processes;
    const names = ["worker-a", "worker-b", "worker-c"].slice(0, workersPerSpace + 1);

    for (const name of names.slice(0, workersPerSpace)) {
      expect(await switchProcess("p", "sync", name, true)).toEqual({ ok: true });
    }
    const over = await switchProcess("p", "sync", names[workersPerSpace], true);
    expect(over.ok === false && over.error).toContain("Workers run all the time");
    expect((await stored(names[workersPerSpace]!))?.enabled).toBe(false);
  });

  it("leaves the record as it was when Google refuses", async () => {
    const { scheduleProcess } = await import("./process-actions");
    googleRefuses = true;
    const result = await scheduleProcess("p", "sync", "report", "0 9 * * 1", null);
    expect(result.ok === false && result.error).toContain(
      "Cloud Scheduler is not switched on",
    );
    expect((await stored("report"))?.schedule).toBeNull();
  });

  it("lets nobody but the app's managers change anything", async () => {
    const { runProcessNow, switchProcess } = await import("./process-actions");
    signedIn = user;
    const refusal = { ok: false, error: "No such app, or you do not manage it." };
    expect(await switchProcess("p", "sync", "worker-a", true)).toEqual(refusal);
    expect(await runProcessNow("p", "sync", "report")).toEqual(refusal);
    expect(told).toHaveLength(0);
  });
});
