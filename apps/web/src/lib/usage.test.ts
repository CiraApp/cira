import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { newId, type User } from "@cira/core";
import type * as CiraDb from "@cira/db";
import type * as CiraDeploy from "@cira/deploy";
import { migratedTestDatabase } from "../../../../packages/db/src/test-database.js";
import { monthSoFar } from "./usage";

/**
 * Whose usage is whose. Google bills one project, so this is the part that
 * has to be right: each service, job and worker pool counted against the app
 * that made it, and nothing counted against a company that did not.
 */

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];
const hasDatabase = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== "";

let database: Awaited<ReturnType<typeof migratedTestDatabase>>;

vi.mock("@cira/db", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDb>();
  return { ...actual, db: () => database };
});

/** What Google says ran, by its own name for each thing. */
let instanceSeconds = new Map<string, number>();
let requests = new Map<string, number>();
let refuse: "not-allowed" | null = null;

vi.mock("@cira/deploy", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDeploy>();
  return {
    ...actual,
    deploymentProvider: () => ({
      readUsage: () =>
        refuse === null
          ? Promise.resolve({ instanceSeconds, requests })
          : Promise.reject(new actual.UsageUnavailableError(refuse)),
    }),
  };
});

const owner: User = {
  id: newId("user"),
  name: "Owner",
  email: "owner@acme.test",
  createdAt: new Date(),
};
const spaceId = newId("space");
const otherSpaceId = newId("space");
const reportsId = newId("app");
const quietId = newId("app");
const strangerId = newId("app");

describe.skipIf(!hasDatabase)("spaceUsage", () => {
  beforeAll(async () => {
    database = await migratedTestDatabase(TEST_DATABASE_URL as string, "cira_usage");
    const { apps, deployments, memberships, processes, spaces, users } =
      await import("@cira/db");
    await database
      .insert(users)
      .values({ id: owner.id, externalId: "u1", name: owner.name, email: owner.email });
    await database.insert(spaces).values([
      { id: spaceId, name: "Acme", slug: "acme", domain: "acme.test" },
      { id: otherSpaceId, name: "Other", slug: "other", domain: "other.test" },
    ]);
    await database
      .insert(memberships)
      .values({ id: newId("membership"), userId: owner.id, spaceId, role: "owner" });
    await database.insert(apps).values([
      { id: reportsId, spaceId, name: "Reports", slug: "reports", ownerUserId: owner.id },
      { id: quietId, spaceId, name: "Quiet", slug: "quiet", ownerUserId: owner.id },
      {
        id: strangerId,
        spaceId: otherSpaceId,
        name: "Stranger",
        slug: "stranger",
        ownerUserId: owner.id,
      },
    ]);
    await database.insert(deployments).values([
      {
        id: newId("deployment"),
        appId: reportsId,
        provider: "cloudrun",
        providerDeploymentId: "b1:acme-reports-0000app1:t1",
        status: "live",
      },
      // An earlier name for the same app: it ran, so it counts.
      {
        id: newId("deployment"),
        appId: reportsId,
        provider: "cloudrun",
        providerDeploymentId: "b0:acme-old-name-0000app1:t0",
        status: "removed",
      },
      {
        id: newId("deployment"),
        appId: quietId,
        provider: "cloudrun",
        providerDeploymentId: "b1:acme-quiet-0000app2:t1",
        status: "live",
      },
      {
        id: newId("deployment"),
        appId: strangerId,
        provider: "cloudrun",
        providerDeploymentId: "b1:other-stranger-0000app3:t1",
        status: "live",
      },
    ]);
    await database.insert(processes).values({
      id: newId("process"),
      appId: reportsId,
      spaceId,
      name: "worker",
      kind: "worker",
      command: "python worker.py",
      serviceSlug: "app",
      memoryMiB: 2048,
      enabled: true,
      source: "Procfile",
    });
  }, 60_000);

  afterAll(async () => {
    await database?.end();
  });

  it("counts each thing against the app that made it, and no one else's", async () => {
    const { spaceUsage } = await import("./usage");
    instanceSeconds = new Map([
      ["acme-reports-0000app1", 3600],
      ["acme-old-name-0000app1", 1800],
      ["worker-0000app1", 7200],
      ["other-stranger-0000app3", 100_000],
    ]);
    requests = new Map([
      ["acme-reports-0000app1", 12_000],
      ["other-stranger-0000app3", 5_000_000],
    ]);

    const outcome = await spaceUsage(spaceId);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const [reports, quiet] = outcome.usage.apps;
    expect(reports?.name).toBe("Reports");
    // Its service under both names, plus its worker.
    expect(reports?.instanceSeconds).toBe(3600 + 1800 + 7200);
    expect(reports?.requests).toBe(12_000);
    // The worker has twice the memory, so its hours cost more than the service's.
    expect(reports?.dollars).toBeCloseTo(
      5400 * (0.000018 + 0.5 * 0.000002) +
        7200 * (0.000018 + 2 * 0.000002) +
        (12_000 / 1_000_000) * 0.4,
      6,
    );
    expect(quiet).toMatchObject({ name: "Quiet", instanceSeconds: 0, dollars: 0 });

    // The other company's app is far larger, and is nowhere in this total.
    expect(outcome.usage.apps).toHaveLength(2);
    expect(outcome.usage.dollars).toBeCloseTo((reports?.dollars ?? 0) + 0, 6);
    expect(outcome.usage.requests).toBe(12_000);
  });

  it("says why rather than showing nothing when Google will not answer", async () => {
    const { spaceUsage } = await import("./usage");
    refuse = "not-allowed";
    expect(await spaceUsage(spaceId)).toEqual({ ok: false, reason: "not-allowed" });
    refuse = null;
  });

  it("measures the month so far, in UTC", () => {
    const window = monthSoFar(new Date("2026-09-19T13:00:00Z"));
    expect(window.since.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(window.until.toISOString()).toBe("2026-09-19T13:00:00.000Z");
  });
});
