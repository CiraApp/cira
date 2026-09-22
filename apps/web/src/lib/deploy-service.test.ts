import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { DEFAULT_LIMITS, newId, type EnvChange, type User } from "@cira/core";
import type * as CiraDb from "@cira/db";
import type * as CiraDeploy from "@cira/deploy";
import { migratedTestDatabase } from "../../../../packages/db/src/test-database.js";

/**
 * A first deploy, against a real database.
 *
 * This path had no test at all, which is a strange gap for the most important
 * thing the product does. It earns one here because creating an app is two
 * writes that have to agree: the app, and the grant that says who may open it.
 *
 * Only the provider and the source store are stubbed. Google is not here and
 * no archive was uploaded, but everything that decides what ends up in the
 * database is the real code.
 */

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];
const hasDatabase = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== "";

let database: Awaited<ReturnType<typeof migratedTestDatabase>>;
/** What the provider was asked to deploy, most recent last. */
const told: Array<{ processes: unknown[]; env?: EnvChange }> = [];
/** How the provider's release command behaves, for the tests that have one. */
const release = {
  needed: false,
  started: 0,
  state: { state: "running" } as
    { state: "running" } | { state: "succeeded" } | { state: "failed"; reason: string },
};
/** Which deploys the provider was asked about, which is also what rolls them out. */
const asked: string[] = [];
/** Flipped by a test that wants the provider to refuse. */
let providerFails = false;

async function makeDatabase() {
  return migratedTestDatabase(TEST_DATABASE_URL as string, "cira_deploy");
}

vi.mock("@cira/db", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDb>();
  return { ...actual, db: () => database };
});

vi.mock("@cira/deploy", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDeploy>();
  return {
    ...actual,
    archiveUri: () => "gs://bucket/source.tgz",
    sourceStore: () => ({
      find: () => Promise.resolve({ size: 1024, object: "source.tgz" }),
    }),
    deploymentProvider: () => ({
      getStatus: (id: string, options?: { releaseDone?: boolean }) => {
        asked.push(id);
        if (release.needed && options?.releaseDone !== true) {
          return Promise.resolve({
            providerDeploymentId: id,
            status: "deploying",
            url: null,
            release: "needed",
          });
        }
        return Promise.resolve({ providerDeploymentId: id, status: "live", url: null });
      },
      startRelease: async () => {
        release.started += 1;
        // Slow enough for a second poll to arrive while the first is here.
        await new Promise((resolve) => setTimeout(resolve, 50));
        return `run-${release.started}`;
      },
      releaseState: () => Promise.resolve(release.state),
      deploy: (input: { processes: unknown[]; env?: EnvChange }) => {
        told.push(input);
        return providerFails
          ? Promise.reject(new Error("the builder said no"))
          : Promise.resolve({
              providerDeploymentId: "prov_1",
              status: "building",
              url: null,
            });
      },
    }),
  };
});

const deployer: User = {
  id: newId("user"),
  name: "Dana",
  email: "dana@demo.test",
  createdAt: new Date(),
};

const spaceId = newId("space");

describe.skipIf(!hasDatabase)("a first deploy", () => {
  beforeAll(async () => {
    database = await makeDatabase();
    const { users, spaces, memberships } = await import("@cira/db");

    await database.insert(users).values({
      id: deployer.id,
      externalId: "ext_dana",
      name: deployer.name,
      email: deployer.email,
    });
    await database
      .insert(spaces)
      .values({ id: spaceId, name: "Paradym", slug: "paradym" });
    await database.insert(memberships).values({
      id: newId("membership"),
      userId: deployer.id,
      spaceId,
      role: "owner",
    });
  });

  afterAll(async () => {
    await database?.end();
  });

  const deploy = async (appName: string, env?: EnvChange) => {
    const { deployToSpace } = await import("./deploy-service");
    return deployToSpace({
      user: deployer,
      spaceSlug: "paradym",
      appName,
      appId: null,
      sourceId: "src_1",
      framework: "unknown",
      container: null,
      ...(env === undefined ? {} : { env }),
    });
  };

  const redeploy = async (
    user: User,
    appId: string,
    appName: string,
    env?: EnvChange,
  ) => {
    const { deployToSpace } = await import("./deploy-service");
    return deployToSpace({
      user,
      spaceSlug: "paradym",
      appName,
      appId,
      sourceId: "src_1",
      framework: "unknown",
      container: null,
      ...(env === undefined ? {} : { env }),
    });
  };

  it("creates the app and the grant that opens it", async () => {
    const outcome = await deploy("Ledger");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const { apps, appAccess } = await import("@cira/db");

    const [app] = await database
      .select()
      .from(apps)
      .where(eq(apps.id, outcome.appId))
      .limit(1);

    expect(app?.slug).toBe("ledger");
    expect(app?.ownerUserId).toBe(deployer.id);

    // The half that used to be able to go missing on its own.
    const grants = await database
      .select()
      .from(appAccess)
      .where(and(eq(appAccess.appId, outcome.appId), eq(appAccess.type, "user")));

    expect(grants).toHaveLength(1);
    expect(grants[0]?.targetId).toBe(deployer.id);
  });

  /**
   * A web app ran at 512 MB whatever its fly.toml or app.json said. Now the
   * repository's size is kept and used, and a person's own choice stands
   * over it on every later deploy.
   */
  it("runs a web app at the size its repository asks, unless a person chose", async () => {
    const { deployToSpace } = await import("./deploy-service");
    const { apps } = await import("@cira/db");
    const { eq } = await import("drizzle-orm");
    const sized = (appId: string | null, webMemoryMiB: number | null) =>
      deployToSpace({
        user: deployer,
        spaceSlug: "paradym",
        appName: "Renderer",
        appId,
        sourceId: "src_1",
        framework: "unknown",
        container: null,
        webMemoryMiB,
      });

    told.length = 0;
    const first = await sized(null, 2048);
    if (!first.ok) throw new Error(first.error);
    expect((told.at(-1) as { memoryMiB?: number }).memoryMiB).toBe(2048);
    const [row] = await database.select().from(apps).where(eq(apps.id, first.appId));
    expect(row?.declaredMemoryMiB).toBe(2048);

    await database.update(apps).set({ memoryMiB: 1024 }).where(eq(apps.id, first.appId));
    await sized(first.appId, 2048);
    expect((told.at(-1) as { memoryMiB?: number }).memoryMiB).toBe(1024);

    // Nothing said and nothing chosen: the default, as before.
    await database.update(apps).set({ memoryMiB: null }).where(eq(apps.id, first.appId));
    await sized(first.appId, null);
    expect((told.at(-1) as { memoryMiB?: number }).memoryMiB).toBe(512);
  });

  /**
   * A deploy request cut off before it wrote its record left the app saying
   * "deploying" for good. Once that is long past, the app goes back to what
   * its deploys say.
   */
  it("settles an app stranded as deploying with no deploy behind it", async () => {
    const { apps, deployments } = await import("@cira/db");
    const { eq } = await import("drizzle-orm");
    const { settleAbandonedDeploys } = await import("./deployment-sync");
    const longAgo = new Date(Date.now() - 60 * 60_000);
    const app = (name: string, updatedAt: Date) => ({
      id: newId("app"),
      spaceId,
      name,
      slug: name.toLowerCase(),
      status: "deploying" as const,
      ownerUserId: deployer.id,
      updatedAt,
    });
    const served = app("Served", longAgo);
    const never = app("Never", longAgo);
    const now = app("Now", new Date());
    await database.insert(apps).values([served, never, now]);
    await database.insert(deployments).values({
      id: newId("deployment"),
      appId: served.id,
      provider: "cloudrun",
      providerDeploymentId: "b-0:svc:tag",
      status: "live",
    });

    await settleAbandonedDeploys(spaceId);
    const status = async (id: string) =>
      (await database.select().from(apps).where(eq(apps.id, id)))[0]?.status;
    expect(await status(served.id)).toBe("live");
    expect(await status(never.id)).toBe("failed");
    // Still inside any request's own time: it may be deploying right now.
    expect(await status(now.id)).toBe("deploying");
  });

  it("records the deployment against the app it just made", async () => {
    const outcome = await deploy("Payroll");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const { deployments } = await import("@cira/db");
    const rows = await database
      .select()
      .from(deployments)
      .where(eq(deployments.appId, outcome.appId));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(outcome.deploymentId);
  });

  /**
   * The quiet one. Rename an app and its old address becomes a forwarding
   * note; deploy something new under the old name and - because live apps and
   * forwarding notes live in different tables - nothing collides and nothing
   * complains. Every link anybody shared to the first app would simply start
   * arriving at the second.
   */
  it("will not hand a new app an address another app still forwards from", async () => {
    const { apps, appSlugHistory } = await import("@cira/db");

    // A name no other test in this file uses, so what this asserts is this
    // rule and not an address some earlier deploy happened to take.
    const first = await deploy("Vault");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.appSlug).toBe("vault");

    // Renamed, the way somebody would: /vault now forwards to /archive.
    await database
      .update(apps)
      .set({ slug: "archive", name: "Archive" })
      .where(eq(apps.id, first.appId));
    await database.insert(appSlugHistory).values({
      id: newId("appSlug"),
      appId: first.appId,
      spaceId,
      slug: "vault",
    });

    const second = await deploy("Vault");
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.appSlug).not.toBe("vault");
    expect(second.appSlug).toBe("vault-2");

    // And the old address still means what it always meant.
    const [note] = await database
      .select({ appId: appSlugHistory.appId })
      .from(appSlugHistory)
      .where(eq(appSlugHistory.slug, "vault"))
      .limit(1);
    expect(note?.appId).toBe(first.appId);
  });

  it("leaves nothing behind when a first deploy is refused, so a retry is the same app", async () => {
    providerFails = true;
    const outcome = await deploy("Broken");
    providerFails = false;

    expect(outcome.ok).toBe(false);

    const { apps } = await import("@cira/db");
    const left = await database
      .select()
      .from(apps)
      .where(and(eq(apps.spaceId, spaceId), eq(apps.name, "Broken")));
    expect(left).toEqual([]);

    // Not "broken-2": the failed attempt did not keep the name.
    const retry = await deploy("Broken");
    expect(retry.ok && retry.appSlug).toBe("broken");
  });

  it("puts a redeploy that never started back to how it was", async () => {
    const first = await deploy("Steady");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const { apps } = await import("@cira/db");
    await database.update(apps).set({ status: "live" }).where(eq(apps.id, first.appId));

    providerFails = true;
    const again = await redeploy(deployer, first.appId, "Steady");
    providerFails = false;
    expect(again.ok).toBe(false);

    // Its last good version is still serving, so it still reads as live.
    const [app] = await database.select().from(apps).where(eq(apps.id, first.appId));
    expect(app?.status).toBe("live");
  });

  it("refuses to deploy for a space whose trial has ended, and says who can fix it", async () => {
    const { spaces, memberships } = await import("@cira/db");
    const { deployToSpace } = await import("./deploy-service");
    const id = newId("space");
    await database.insert(spaces).values({
      id,
      name: "Lapsed Co",
      slug: "lapsed-co",
      createdAt: new Date(Date.now() - 30 * 86_400_000),
    });
    await database.insert(memberships).values({
      id: newId("membership"),
      userId: deployer.id,
      spaceId: id,
      role: "owner",
    });
    told.length = 0;

    const outcome = await deployToSpace({
      user: deployer,
      spaceSlug: "lapsed-co",
      appName: "Late",
      appId: null,
      sourceId: "src_1",
      framework: "unknown",
      container: null,
    });
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error).toContain("An admin can subscribe");
    expect(told).toEqual([]);
  });

  describe("two deploys of one app", () => {
    it("never rolls out the older one once a newer one has started", async () => {
      const first = await deploy("Overlap");
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const second = await redeploy(deployer, first.appId, "Overlap");
      expect(second.ok).toBe(true);
      if (!second.ok) return;

      const { deployments } = await import("@cira/db");
      const [older] = await database
        .select()
        .from(deployments)
        .where(eq(deployments.id, first.deploymentId));
      expect(older?.status).toBe("superseded");

      // Looking at it again, as the watcher or a CLI still polling it would,
      // does not ask the provider - asking is what rolls a build out.
      asked.length = 0;
      const { reconcileDeployment } = await import("./deployment-sync");
      const again = await reconcileDeployment(older as never);
      expect(again.status).toBe("superseded");
      expect(asked).toEqual([]);
    });

    /**
     * The newest deploy is not newer than itself. Postgres keeps its
     * timestamp in microseconds and the row read back keeps milliseconds, and
     * comparing with the copy made every deploy in production supersede
     * itself before it could go out.
     */
    it("lets the newest deploy go out, read back as production reads it", async () => {
      const first = await deploy("Only One");
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const { deployments } = await import("@cira/db");
      const { eq } = await import("drizzle-orm");
      const [row] = await database
        .select()
        .from(deployments)
        .where(eq(deployments.id, first.deploymentId));
      // Written by the database's clock, with its microseconds, as it is live.
      expect(row!.createdAt.getMilliseconds()).toBeGreaterThanOrEqual(0);

      asked.length = 0;
      const { reconcileDeployment } = await import("./deployment-sync");
      const now = await reconcileDeployment(row as never);
      expect(now.status).toBe("live");
      expect(asked).toEqual(["prov_1"]);
    });

    /**
     * The release command is a migration. Several things poll a deploy at
     * once - the CLI, the app's page, the watcher - and it must run once.
     */
    describe("with a release command", () => {
      const fresh = async (name: string) => {
        const outcome = await deploy(name);
        if (!outcome.ok) throw new Error(outcome.error);
        const { deployments } = await import("@cira/db");
        const { eq } = await import("drizzle-orm");
        const [row] = await database
          .select()
          .from(deployments)
          .where(eq(deployments.id, outcome.deploymentId));
        return row!;
      };

      it("starts it once however many polls arrive, and goes live when it succeeds", async () => {
        const { reconcileDeployment } = await import("./deployment-sync");
        const { deployments } = await import("@cira/db");
        const { eq } = await import("drizzle-orm");
        Object.assign(release, { needed: true, started: 0, state: { state: "running" } });
        try {
          const row = await fresh("Migrates");
          const polls = await Promise.all([
            reconcileDeployment(row as never),
            reconcileDeployment(row as never),
            reconcileDeployment(row as never),
          ]);
          expect(release.started).toBe(1);
          expect(polls.every((p) => p.status !== "live")).toBe(true);

          const read = async () =>
            (
              await database.select().from(deployments).where(eq(deployments.id, row.id))
            )[0]!;
          expect((await read()).releaseRun).toBe("run-1");
          // Still running: nothing rolls out, nothing starts again.
          await reconcileDeployment((await read()) as never);
          expect(release.started).toBe(1);

          release.state = { state: "succeeded" };
          const done = await reconcileDeployment((await read()) as never);
          expect(done.status).toBe("live");
          expect((await read()).releaseDoneAt).not.toBeNull();
          expect(release.started).toBe(1);
        } finally {
          release.needed = false;
        }
      });

      it("fails the deploy with nothing rolled out when it fails", async () => {
        const { reconcileDeployment } = await import("./deployment-sync");
        const { deployments } = await import("@cira/db");
        const { eq } = await import("drizzle-orm");
        Object.assign(release, {
          needed: true,
          started: 0,
          state: { state: "failed", reason: "The release command failed (exit code 1)." },
        });
        try {
          const row = await fresh("Bad Migration");
          await reconcileDeployment(row as never);
          const [claimed] = await database
            .select()
            .from(deployments)
            .where(eq(deployments.id, row.id));
          const failed = await reconcileDeployment(claimed as never);
          expect(failed.status).toBe("failed");
          expect(failed.failureReason).toContain("the previous version is still serving");
        } finally {
          release.needed = false;
        }
      });
    });

    it("catches an older deploy still in flight even if it was never marked", async () => {
      const first = await deploy("Overlap Two");
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const second = await redeploy(deployer, first.appId, "Overlap Two");
      expect(second.ok).toBe(true);
      if (!second.ok) return;

      // As if the two had raced past the moment the older one is marked.
      const { deployments } = await import("@cira/db");
      await database
        .update(deployments)
        .set({ status: "building" })
        .where(eq(deployments.id, first.deploymentId));
      const [older] = await database
        .select()
        .from(deployments)
        .where(eq(deployments.id, first.deploymentId));

      asked.length = 0;
      const { reconcileDeployment } = await import("./deployment-sync");
      expect((await reconcileDeployment(older as never)).status).toBe("superseded");
      expect(asked).toEqual([]);
    });
  });

  describe("who may redeploy an app", () => {
    const colleague: User = {
      id: newId("user"),
      name: "Sam",
      email: "sam@demo.test",
      createdAt: new Date(),
    };

    beforeAll(async () => {
      const { users, memberships } = await import("@cira/db");
      await database.insert(users).values({
        id: colleague.id,
        externalId: "ext_sam",
        name: colleague.name,
        email: colleague.email,
      });
      await database.insert(memberships).values({
        id: newId("membership"),
        userId: colleague.id,
        spaceId,
        role: "member",
      });
    });

    it("refuses a member who does not manage it, even with its id", async () => {
      const first = await deploy("Payroll");
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      told.length = 0;

      const outcome = await redeploy(colleague, first.appId, "Payroll");
      expect(outcome.ok).toBe(false);
      expect(!outcome.ok && outcome.error).toContain("You do not manage Payroll");
      // Refused before Google was asked for anything.
      expect(told).toEqual([]);
    });

    it("lets a member deploy an app they were given manage on", async () => {
      const first = await deploy("Reports");
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const { appAccess } = await import("@cira/db");
      await database.insert(appAccess).values({
        id: newId("access"),
        appId: first.appId,
        type: "user",
        targetId: colleague.id,
        level: "manage",
      });

      const outcome = await redeploy(colleague, first.appId, "Reports");
      expect(outcome.ok).toBe(true);
    });

    it("does not let a grant to use the app stand in for managing it", async () => {
      const first = await deploy("Handbook");
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const { appAccess } = await import("@cira/db");
      await database.insert(appAccess).values({
        id: newId("access"),
        appId: first.appId,
        type: "user",
        targetId: colleague.id,
        level: "use",
      });

      const outcome = await redeploy(colleague, first.appId, "Handbook");
      expect(outcome.ok).toBe(false);
    });
  });

  describe("variables on a redeploy", () => {
    it("changes nothing when a redeploy brings none, and keeps what was set", async () => {
      const first = await deploy("Ledger Two", {
        set: { DATABASE_URL: "postgres://db/ledger", API_KEY: "k1" },
        unset: [],
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      told.length = 0;

      // A teammate's clone, or CI: no `.env` at all.
      const again = await redeploy(deployer, first.appId, "Ledger Two");
      expect(again.ok).toBe(true);
      expect(told[0]?.env).toEqual({ set: {}, unset: [] });

      const { appEnvVars } = await import("@cira/db");
      const kept = await database
        .select({ key: appEnvVars.key })
        .from(appEnvVars)
        .where(eq(appEnvVars.appId, first.appId));
      expect(kept.map((r) => r.key).sort()).toEqual(["API_KEY", "DATABASE_URL"]);
    });

    it("takes a variable away only when asked to", async () => {
      const first = await deploy("Ledger Three", {
        set: { DATABASE_URL: "postgres://db/three", OLD_FLAG: "1" },
        unset: [],
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      const again = await redeploy(deployer, first.appId, "Ledger Three", {
        set: { DATABASE_URL: "postgres://db/three-new" },
        unset: ["OLD_FLAG"],
      });
      expect(again.ok).toBe(true);

      const { appEnvVars } = await import("@cira/db");
      const kept = await database
        .select({ key: appEnvVars.key })
        .from(appEnvVars)
        .where(eq(appEnvVars.appId, first.appId));
      expect(kept.map((r) => r.key)).toEqual(["DATABASE_URL"]);
    });
  });

  /**
   * The two limits a space meets when deploying, each in its own space so the
   * numbers are exact. Both refuse before anything is written or built.
   */
  describe("within a space's limits", () => {
    const { appsPerSpace, deploysPerSpacePerHour } = DEFAULT_LIMITS;

    const spaceWith = async (slug: string) => {
      const { spaces, memberships } = await import("@cira/db");
      const id = newId("space");
      await database.insert(spaces).values({ id, name: slug, slug });
      await database.insert(memberships).values({
        id: newId("membership"),
        userId: deployer.id,
        spaceId: id,
        role: "owner",
      });
      return id;
    };

    const deployTo = async (spaceSlug: string, appName: string, appId: string | null) => {
      const { deployToSpace } = await import("./deploy-service");
      return deployToSpace({
        user: deployer,
        spaceSlug,
        appName,
        appId,
        sourceId: "src_1",
        framework: "unknown",
        container: null,
      });
    };

    it("refuses a new app past the space's allowance, and still redeploys one", async () => {
      const { apps } = await import("@cira/db");
      const id = await spaceWith("crowded");
      const held = Array.from({ length: appsPerSpace }, (_, n) => ({
        id: newId("app"),
        spaceId: id,
        name: `App ${n}`,
        slug: `app-${n}`,
        status: "live" as const,
        ownerUserId: deployer.id,
      }));
      await database.insert(apps).values(held);

      const refused = await deployTo("crowded", "One Too Many", null);
      expect(refused).toMatchObject({ ok: false, limited: true });
      expect(!refused.ok && refused.error).toContain(`already has ${appsPerSpace} apps`);
      expect(await database.select().from(apps).where(eq(apps.spaceId, id))).toHaveLength(
        appsPerSpace,
      );

      // A fix to an app the space already has is never what the limit stops.
      const redeploy = await deployTo("crowded", "App 0", held[0]!.id);
      expect(redeploy.ok).toBe(true);
    });

    it("refuses a deploy past the hourly allowance, and says when to try again", async () => {
      const { apps, deployments } = await import("@cira/db");
      const id = await spaceWith("busy");
      const appId = newId("app");
      await database.insert(apps).values({
        id: appId,
        spaceId: id,
        name: "Busy",
        slug: "busy",
        status: "live",
        ownerUserId: deployer.id,
      });
      // One started just over an hour ago, which no longer counts, and a full
      // hour's worth after it.
      await database.insert(deployments).values([
        {
          id: newId("deployment"),
          appId,
          provider: "cloudrun",
          providerDeploymentId: "old",
          status: "live",
          createdAt: new Date(Date.now() - 61 * 60_000),
        },
        ...Array.from({ length: deploysPerSpacePerHour }, (_, n) => ({
          id: newId("deployment"),
          appId,
          provider: "cloudrun",
          providerDeploymentId: `d${n}`,
          status: "live" as const,
          createdAt: new Date(Date.now() - (50 - n) * 60_000),
        })),
      ]);

      const refused = await deployTo("busy", "Busy", appId);
      expect(refused).toMatchObject({ ok: false, limited: true });
      expect(!refused.ok && refused.error).toMatch(/Try again in \d+ minutes?\./);

      // Nothing was started: no new deployment row, and the app is not left
      // marked as deploying.
      const rows = await database
        .select()
        .from(deployments)
        .where(eq(deployments.appId, appId));
      expect(rows).toHaveLength(deploysPerSpacePerHour + 1);
      const [app] = await database.select().from(apps).where(eq(apps.id, appId));
      expect(app?.status).toBe("live");
    });
  });
  describe("workers and scheduled runs", () => {
    const deployWith = async (args: {
      appId: string | null;
      web?: boolean;
      processes: Array<{
        name: string;
        kind: "worker" | "scheduled";
        command: string;
        schedule: string | null;
        source: "Procfile" | "fly.toml" | "GitHub Actions";
        memoryMiB: number | null;
        service: string;
      }>;
    }) => {
      const { deployToSpace } = await import("./deploy-service");
      return deployToSpace({
        user: deployer,
        spaceSlug: "paradym",
        appName: "Sync",
        appId: args.appId,
        sourceId: "src_1",
        framework: "python",
        container: null,
        ...(args.web === undefined ? {} : { web: args.web }),
        processes: args.processes,
      });
    };
    const report = {
      name: "report",
      kind: "scheduled" as const,
      command: "python report.py",
      schedule: "0 9 * * 1",
      source: "GitHub Actions" as const,
      memoryMiB: null,
      service: "app",
    };

    it("deploys an app that is only a scheduled run, and records it off", async () => {
      const { deployments, processes } = await import("@cira/db");
      const outcome = await deployWith({ appId: null, web: false, processes: [report] });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;

      const [deployment] = await database
        .select()
        .from(deployments)
        .where(eq(deployments.appId, outcome.appId));
      expect(deployment?.servesWeb).toBe(false);

      const rows = await database
        .select()
        .from(processes)
        .where(eq(processes.appId, outcome.appId));
      expect(rows).toMatchObject([
        { name: "report", kind: "scheduled", schedule: "0 9 * * 1", enabled: false },
      ]);
      expect(told.at(-1)?.processes).toEqual([
        {
          name: "report",
          kind: "scheduled",
          command: "python report.py",
          service: "app",
          schedule: "0 9 * * 1",
          timeoutSeconds: 600,
          // It asked for none, so it is given the default.
          memoryMiB: 1024,
          enabled: false,
        },
      ]);
    });

    it("keeps what a person decided when the app is deployed again", async () => {
      const { processes } = await import("@cira/db");
      const first = await deployWith({ appId: null, web: false, processes: [report] });
      if (!first.ok) throw new Error(first.error);

      await database
        .update(processes)
        .set({ enabled: true, schedule: "30 7 * * *", scheduleSetAt: new Date() })
        .where(eq(processes.appId, first.appId));

      await deployWith({
        appId: first.appId,
        web: false,
        processes: [{ ...report, command: "python report.py --all" }],
      });

      const [row] = await database
        .select()
        .from(processes)
        .where(eq(processes.appId, first.appId));
      expect(row).toMatchObject({
        command: "python report.py --all",
        schedule: "30 7 * * *",
        enabled: true,
      });
      expect(told.at(-1)?.processes).toMatchObject([
        { schedule: "30 7 * * *", enabled: true },
      ]);
    });

    it("refuses an app with no web process and nothing else to run", async () => {
      const outcome = await deployWith({ appId: null, web: false, processes: [] });
      expect(outcome).toMatchObject({
        ok: false,
        error: "This app has no web process and nothing else to run.",
      });
    });
  });
});
