import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { desc, eq } from "drizzle-orm";
import { newId, type DeploymentResult, type User } from "@cira/core";
import type * as CiraDb from "@cira/db";
import type * as CiraDeploy from "@cira/deploy";
import { migratedTestDatabase } from "../../../../packages/db/src/test-database.js";

/**
 * Putting an app back on a build it ran before: who may, what the record says
 * afterwards, and the one thing a rollback must never do - run a migration
 * again on its way back.
 */

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];
const hasDatabase = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== "";

let database: Awaited<ReturnType<typeof migratedTestDatabase>>;

vi.mock("@cira/db", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDb>();
  return { ...actual, db: () => database };
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

/** Which builds the provider was asked to put back, and what it answers. */
const restored: string[] = [];
let answer: DeploymentResult | Error = {
  providerDeploymentId: "",
  status: "deploying",
  url: null,
};

vi.mock("@cira/deploy", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDeploy>();
  return {
    ...actual,
    deploymentProvider: () => ({
      restore: (handle: string) => {
        restored.push(handle);
        if (answer instanceof Error) return Promise.reject(answer);
        return Promise.resolve({ ...answer, providerDeploymentId: handle });
      },
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
  email: "o@r.test",
  createdAt: new Date(),
};
const onlooker: User = {
  id: newId("user"),
  name: "Onlooker",
  email: "l@r.test",
  createdAt: new Date(),
};
const spaceId = newId("space");
const appId = newId("app");

const OLD = newId("deployment");
const MIGRATED = newId("deployment");
const BROKEN = newId("deployment");

describe.skipIf(!hasDatabase)("rolling back", () => {
  beforeAll(async () => {
    database = await migratedTestDatabase(TEST_DATABASE_URL as string, "cira_roll");
    const { appAccess, apps, memberships, spaces, users } = await import("@cira/db");
    await database.insert(users).values([
      { id: owner.id, externalId: "r1", name: owner.name, email: owner.email },
      {
        id: onlooker.id,
        externalId: "r2",
        name: onlooker.name,
        email: onlooker.email,
      },
    ]);
    await database
      .insert(spaces)
      .values({ id: spaceId, name: "R", slug: "r", domain: "r.test" });
    await database.insert(memberships).values([
      { id: newId("membership"), userId: owner.id, spaceId, role: "member" },
      { id: newId("membership"), userId: onlooker.id, spaceId, role: "member" },
    ]);
    await database.insert(apps).values({
      id: appId,
      spaceId,
      name: "Orders",
      slug: "orders",
      status: "live",
      ownerUserId: owner.id,
    });
    // Someone who may open the app but not manage it.
    await database.insert(appAccess).values({
      id: newId("access"),
      appId,
      type: "user",
      targetId: onlooker.id,
    });
  }, 60_000);

  afterAll(async () => {
    signedIn = null;
    await database?.end();
  });

  beforeEach(async () => {
    const { apps, deployments } = await import("@cira/db");
    restored.length = 0;
    answer = { providerDeploymentId: "", status: "deploying", url: null };
    signedIn = owner;
    await database.delete(deployments).where(eq(deployments.appId, appId));
    await database.update(apps).set({ status: "live" }).where(eq(apps.id, appId));

    const minute = 60_000;
    const now = Date.now();
    await database.insert(deployments).values([
      {
        id: OLD,
        appId,
        provider: "cloudrun",
        providerDeploymentId: "b1:r-orders-1:t1",
        status: "superseded",
        url: "https://orders.example",
        createdAt: new Date(now - 30 * minute),
      },
      {
        id: MIGRATED,
        appId,
        provider: "cloudrun",
        providerDeploymentId: "b2:r-orders-1:t2",
        status: "superseded",
        url: "https://orders.example",
        releaseRun: "runs/1",
        releaseDoneAt: new Date(now - 20 * minute),
        createdAt: new Date(now - 20 * minute),
      },
      {
        id: BROKEN,
        appId,
        provider: "cloudrun",
        providerDeploymentId: "b3:r-orders-1:t3",
        status: "live",
        url: "https://orders.example",
        createdAt: new Date(now - 10 * minute),
      },
    ]);
  });

  const newest = async () => {
    const { deployments } = await import("@cira/db");
    const [row] = await database
      .select()
      .from(deployments)
      .where(eq(deployments.appId, appId))
      .orderBy(desc(deployments.createdAt))
      .limit(1);
    return row;
  };

  it("points the app at the older build and says where it came from", async () => {
    const { rollBackTo } = await import("./rollback-actions");
    const result = await rollBackTo("r", "orders", OLD);

    expect(result.ok).toBe(true);
    expect(restored).toEqual(["b1:r-orders-1:t1"]);

    const row = await newest();
    expect(row?.providerDeploymentId).toBe("b1:r-orders-1:t1");
    expect(row?.restoredFromId).toBe(OLD);
    expect(row?.status).toBe("deploying");
    // The build that is being left behind is no longer what is coming.
    expect(row?.id).not.toBe(OLD);
  });

  it("never runs the release command again on the way back", async () => {
    const { rollBackTo } = await import("./rollback-actions");
    await rollBackTo("r", "orders", MIGRATED);

    // A poll asks the provider with releaseDone true only when this is set,
    // and a migration written to move a schema forward must not run twice.
    expect((await newest())?.releaseDoneAt).not.toBeNull();
  });

  it("warns when a deploy since the one being gone back to migrated", async () => {
    const { planRollback } = await import("./rollback-actions");

    const past = await planRollback("r", "orders", OLD);
    expect(past.ok && past.plan.ranSetup).toBe(true);

    const after = await planRollback("r", "orders", MIGRATED);
    expect(after.ok && after.plan.ranSetup).toBe(false);
  });

  it("calls the newest deploy a redeploy rather than a rollback", async () => {
    const { planRollback } = await import("./rollback-actions");
    const plan = await planRollback("r", "orders", BROKEN);
    expect(plan.ok && plan.plan.current).toBe(true);
  });

  it("refuses someone who may open the app but not manage it", async () => {
    signedIn = onlooker;
    const { rollBackTo } = await import("./rollback-actions");
    const result = await rollBackTo("r", "orders", OLD);

    expect(result).toEqual({
      ok: false,
      error: "You do not manage this app, so you cannot change what it runs.",
    });
    expect(restored).toEqual([]);
  });

  it("refuses a deploy of another app", async () => {
    const { apps, deployments } = await import("@cira/db");
    const otherApp = newId("app");
    const stranger = newId("deployment");
    await database.insert(apps).values({
      id: otherApp,
      spaceId,
      name: "Other",
      slug: "other",
      status: "live",
      ownerUserId: owner.id,
    });
    await database.insert(deployments).values({
      id: stranger,
      appId: otherApp,
      provider: "cloudrun",
      providerDeploymentId: "b9:r-other-1:t9",
      status: "live",
    });

    const { rollBackTo } = await import("./rollback-actions");
    const result = await rollBackTo("r", "orders", stranger);

    expect(result).toEqual({ ok: false, error: "No such deploy of this app." });
    expect(restored).toEqual([]);

    await database.delete(deployments).where(eq(deployments.appId, otherApp));
    await database.delete(apps).where(eq(apps.id, otherApp));
  });

  it("refuses a deploy that never went live", async () => {
    const { deployments } = await import("@cira/db");
    const failed = newId("deployment");
    await database.insert(deployments).values({
      id: failed,
      appId,
      provider: "cloudrun",
      providerDeploymentId: "b4:r-orders-1:t4",
      status: "failed",
    });

    const { rollBackTo } = await import("./rollback-actions");
    const result = await rollBackTo("r", "orders", failed);

    expect(result).toEqual({
      ok: false,
      error: "That deploy never went live, so there is no build to go back to.",
    });
    expect(restored).toEqual([]);
  });

  it("leaves the app as it was when the provider refuses", async () => {
    const { apps } = await import("@cira/db");
    answer = new Error("that build has been deleted");

    const { rollBackTo } = await import("./rollback-actions");
    const result = await rollBackTo("r", "orders", OLD);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("that build has been deleted");
    const [app] = await database.select().from(apps).where(eq(apps.id, appId));
    expect(app?.status).toBe("live");
    // Nothing new in the history: the rollback did not happen.
    expect((await newest())?.id).toBe(BROKEN);
  });

  it("finishes an app of only workers the moment they are back", async () => {
    const { apps } = await import("@cira/db");
    answer = { providerDeploymentId: "", status: "live", url: null };

    const { rollBackTo } = await import("./rollback-actions");
    expect((await rollBackTo("r", "orders", OLD)).ok).toBe(true);

    const [app] = await database.select().from(apps).where(eq(apps.id, appId));
    expect(app?.status).toBe("live");
  });
});
