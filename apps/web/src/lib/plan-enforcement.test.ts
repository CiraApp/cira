import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { newId, type ProcessSpec } from "@cira/core";
import type * as CiraDb from "@cira/db";
import type * as CiraDeploy from "@cira/deploy";
import { migratedTestDatabase } from "../../../../packages/db/src/test-database.js";

/**
 * What a plan no longer covers is switched off - at Google first, then in the
 * record - and nothing else is touched.
 */

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];
const hasDatabase = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== "";

let database: Awaited<ReturnType<typeof migratedTestDatabase>>;

vi.mock("@cira/db", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDb>();
  return { ...actual, db: () => database };
});

const told: { processes: ProcessSpec[]; warm: number[] } = { processes: [], warm: [] };
vi.mock("@cira/deploy", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDeploy>();
  return {
    ...actual,
    deploymentProvider: () => ({
      setProcess: (_handle: string, spec: ProcessSpec) => {
        told.processes.push(spec);
        return Promise.resolve();
      },
      setMinInstances: (_handle: string, n: number) => {
        told.warm.push(n);
        return Promise.resolve();
      },
    }),
  };
});

const DAY = 86_400_000;

async function spaceWith(args: {
  createdAt: Date;
  plan?: string;
  workers: number;
  warm?: boolean;
}): Promise<{ spaceId: string; appId: string }> {
  const { apps, deployments, processes, spaces, users } = await import("@cira/db");
  const spaceId = newId("space");
  const owner = newId("user");
  await database
    .insert(users)
    .values({ id: owner, externalId: owner, name: "O", email: `${owner}@x.test` });
  await database.insert(spaces).values({
    id: spaceId,
    name: "S",
    slug: spaceId.slice(-12),
    plan: args.plan ?? "trial",
    createdAt: args.createdAt,
  });
  const appId = newId("app");
  await database.insert(apps).values({
    id: appId,
    spaceId,
    name: "Queue",
    slug: "queue",
    ownerUserId: owner,
    minInstances: args.warm === true ? 1 : 0,
  });
  await database.insert(deployments).values({
    id: newId("deployment"),
    appId,
    provider: "cloudrun",
    providerDeploymentId: `b1:s-queue-${appId.slice(-8)}:t1`,
    status: "live",
  });
  for (let i = 0; i < args.workers; i += 1) {
    await database.insert(processes).values({
      id: newId("process"),
      appId,
      spaceId,
      name: `w${i}`,
      kind: "worker",
      command: "python w.py",
      serviceSlug: "app",
      source: "Procfile",
      enabled: true,
      updatedAt: new Date(Date.now() - (args.workers - i) * 60_000),
    });
  }
  return { spaceId, appId };
}

describe.skipIf(!hasDatabase)("enforcePlan", () => {
  beforeAll(async () => {
    database = await migratedTestDatabase(TEST_DATABASE_URL as string, "cira_enforce");
  }, 60_000);

  afterAll(async () => {
    await database?.end();
  });

  beforeEach(() => {
    told.processes.length = 0;
    told.warm.length = 0;
  });

  const enabled = async (appId: string) => {
    const { processes } = await import("@cira/db");
    return (await database.select().from(processes).where(eq(processes.appId, appId)))
      .filter((p) => p.enabled)
      .map((p) => p.name)
      .sort();
  };

  it("keeps a trial to its one worker, the one switched on first", async () => {
    const { enforcePlan } = await import("./plan-enforcement");
    const { spaceId, appId } = await spaceWith({ createdAt: new Date(), workers: 2 });
    const out = await enforcePlan(spaceId);
    expect(out.switchedOff).toEqual(["Queue's worker w1"]);
    expect(await enabled(appId)).toEqual(["w0"]);
    expect(told.processes.map((p) => [p.name, p.enabled])).toEqual([["w1", false]]);
  });

  it("switches everything that runs by the hour off once a trial has ended", async () => {
    const { enforcePlan } = await import("./plan-enforcement");
    const { spaceId, appId } = await spaceWith({
      createdAt: new Date(Date.now() - 20 * DAY),
      workers: 1,
    });
    expect((await enforcePlan(spaceId)).switchedOff).toHaveLength(1);
    expect(await enabled(appId)).toEqual([]);
  });

  it("cools a warm app once a subscription has ended, and leaves a paying one alone", async () => {
    const { enforcePlan } = await import("./plan-enforcement");
    const { apps } = await import("@cira/db");
    const ended = await spaceWith({
      createdAt: new Date(Date.now() - 90 * DAY),
      plan: "trial",
      workers: 0,
      warm: true,
    });
    expect((await enforcePlan(ended.spaceId)).cooled).toEqual(["Queue"]);
    const [app] = await database.select().from(apps).where(eq(apps.id, ended.appId));
    expect(app?.minInstances).toBe(0);
    expect(told.warm).toEqual([0]);

    told.warm.length = 0;
    const paying = await spaceWith({
      createdAt: new Date(Date.now() - 90 * DAY),
      plan: "team",
      workers: 2,
      warm: true,
    });
    expect(await enforcePlan(paying.spaceId)).toEqual({ switchedOff: [], cooled: [] });
    expect(told.warm).toEqual([]);
  });
});
