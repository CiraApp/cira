import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { newId, RuntimeLogsError, type RuntimeLogQuery, type User } from "@cira/core";
import type * as CiraDb from "@cira/db";
import type * as CiraDeploy from "@cira/deploy";
import { migratedTestDatabase } from "../../../../packages/db/src/test-database.js";

/**
 * Who may read an app's runtime logs, and what they can make Cira ask Google.
 *
 * The provider is replaced by one that records what it was asked, because the
 * point here is what reaches it: which service, which slice of time, and
 * nothing at all for anyone who does not manage the app.
 */

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];
const hasDatabase = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== "";

let database: Awaited<ReturnType<typeof migratedTestDatabase>>;

vi.mock("@cira/db", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDb>();
  return { ...actual, db: () => database };
});

const asked: Array<{ deploymentId: string; query: RuntimeLogQuery }> = [];
let answer: () => Promise<unknown> = () =>
  Promise.resolve({ entries: [], nextPageToken: null });

vi.mock("@cira/deploy", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDeploy>();
  return {
    ...actual,
    deploymentProvider: () => ({
      getRuntimeLogs: (deploymentId: string, query: RuntimeLogQuery) => {
        asked.push({ deploymentId, query });
        return answer();
      },
    }),
  };
});

let signedIn: User | null = null;
vi.mock("@/lib/identity", () => ({
  getCurrentUser: () => Promise.resolve(signedIn),
  requireCurrentUser: () => Promise.resolve(signedIn),
}));

const person = (name: string): User => ({
  id: newId("user"),
  name,
  email: `${name.toLowerCase()}@logs.test`,
  createdAt: new Date(),
});
const owner = person("Owner");
const admin = person("Admin");
/** Can open the app, and does not manage it. */
const user = person("User");

const spaceId = newId("space");
const appId = newId("app");
const demoAppId = newId("app");
const idleAppId = newId("app");
const HANDLE = "build-1:logs-orders-3f9a1c2e:tag";

describe.skipIf(!hasDatabase)("fetchRuntimeLogs", () => {
  beforeAll(async () => {
    database = await migratedTestDatabase(TEST_DATABASE_URL as string, "cira_logs");
    const { appAccess, apps, deployments, memberships, spaces, users } =
      await import("@cira/db");

    await database.insert(users).values(
      [owner, admin, user].map((u, i) => ({
        id: u.id,
        externalId: `l${i}`,
        name: u.name,
        email: u.email,
      })),
    );
    await database
      .insert(spaces)
      .values({ id: spaceId, name: "Logs", slug: "logs", domain: "logs.test" });
    await database.insert(memberships).values([
      { id: newId("membership"), userId: owner.id, spaceId, role: "member" },
      { id: newId("membership"), userId: admin.id, spaceId, role: "admin" },
      { id: newId("membership"), userId: user.id, spaceId, role: "member" },
    ]);
    await database.insert(apps).values([
      {
        id: appId,
        spaceId,
        name: "Orders",
        slug: "orders",
        status: "live",
        ownerUserId: owner.id,
      },
      {
        id: demoAppId,
        spaceId,
        name: "Demo",
        slug: "demo",
        status: "live",
        ownerUserId: owner.id,
      },
      {
        id: idleAppId,
        spaceId,
        name: "Idle",
        slug: "idle",
        status: "live",
        ownerUserId: owner.id,
      },
    ]);
    await database
      .insert(appAccess)
      .values([{ id: newId("access"), appId, type: "user", targetId: user.id }]);
    await database.insert(deployments).values([
      {
        id: newId("deployment"),
        appId,
        provider: "cloudrun",
        providerDeploymentId: HANDLE,
        status: "live",
        url: "https://orders.example",
      },
      {
        id: newId("deployment"),
        appId: demoAppId,
        provider: "demo",
        providerDeploymentId: "demo-1",
        status: "live",
        url: "https://demo.example",
      },
    ]);
  }, 60_000);

  afterAll(async () => {
    signedIn = null;
    await database?.end();
  });

  beforeEach(() => {
    asked.length = 0;
    answer = () => Promise.resolve({ entries: [], nextPageToken: null });
  });

  it("reads the logs of the app's own service for whoever manages it", async () => {
    const { fetchRuntimeLogs } = await import("./runtime-log-actions");

    for (const who of [owner, admin]) {
      signedIn = who;
      asked.length = 0;
      const result = await fetchRuntimeLogs("logs", "orders", { range: "1h" });

      expect(result.ok).toBe(true);
      expect(asked).toHaveLength(1);
      // The deployment's own handle, which names the service; nothing from
      // the browser says which service to read.
      expect(asked[0]?.deploymentId).toBe(HANDLE);
      const { since, until, order, limit } = asked[0]!.query;
      expect(until.getTime() - since.getTime()).toBe(60 * 60_000);
      expect(order).toBe("newest");
      expect(limit).toBe(200);
    }
  });

  it("gives someone who can only use the app nothing, and does not ask Google", async () => {
    const { fetchRuntimeLogs } = await import("./runtime-log-actions");
    signedIn = user;

    const result = await fetchRuntimeLogs("logs", "orders", { range: "1h" });
    const missing = await fetchRuntimeLogs("logs", "no-such-app", { range: "1h" });

    expect(result).toEqual({
      ok: false,
      reason: "no-access",
      error: "No such app, or you do not manage it.",
    });
    // The same words for an app that does not exist.
    expect(missing).toEqual(result);
    expect(asked).toHaveLength(0);
  });

  it("refuses a request no page could have sent, before Google is asked", async () => {
    const { fetchRuntimeLogs } = await import("./runtime-log-actions");
    signedIn = owner;

    for (const bad of [
      { range: "1y" },
      { minimum: "trace" },
      { search: 42 },
      { around: "yesterday-ish" },
      { around: "2020-01-01T00:00:00Z" },
      { pageToken: "t" },
      { window: { since: "2026-01-01T00:00:00Z", until: "2025-01-01T00:00:00Z" } },
      { after: new Date(Date.now() + 3_600_000).toISOString() },
    ]) {
      const result = await fetchRuntimeLogs("logs", "orders", bad as never);
      expect({ bad, reason: result.ok ? "ok" : result.reason }).toEqual({
        bad,
        reason: "bad-request",
      });
    }
    expect(asked).toHaveLength(0);
  });

  it("reads forwards for Live, and pages backwards within the same window", async () => {
    const { fetchRuntimeLogs } = await import("./runtime-log-actions");
    signedIn = owner;

    const after = new Date(Date.now() - 30_000).toISOString();
    await fetchRuntimeLogs("logs", "orders", { after, minimum: "error", search: "boom" });
    expect(asked[0]?.query).toMatchObject({
      order: "oldest",
      minimum: "error",
      search: "boom",
      pageToken: null,
    });
    expect(asked[0]?.query.since.toISOString()).toBe(after);

    const since = new Date(Date.now() - 3_600_000).toISOString();
    const until = new Date().toISOString();
    await fetchRuntimeLogs("logs", "orders", {
      window: { since, until },
      pageToken: "older",
    });
    expect(asked[1]?.query).toMatchObject({ order: "newest", pageToken: "older" });
    expect(asked[1]?.query.since.toISOString()).toBe(since);
  });

  it("says why there is nothing to read, in words", async () => {
    const { fetchRuntimeLogs } = await import("./runtime-log-actions");
    signedIn = owner;

    const demo = await fetchRuntimeLogs("logs", "demo", { range: "1h" });
    expect(demo.ok === false && demo.reason).toBe("demo");

    const idle = await fetchRuntimeLogs("logs", "idle", { range: "1h" });
    expect(idle.ok === false && idle.reason).toBe("not-deployed");
    expect(asked).toHaveLength(0);

    answer = () => Promise.reject(new RuntimeLogsError("403 from Google", "not-allowed"));
    const refused = await fetchRuntimeLogs("logs", "orders", { range: "1h" });
    expect(refused).toMatchObject({ ok: false, reason: "not-allowed" });
    expect(refused.ok === false && refused.error).toContain("one grant on the project");
  });
});
