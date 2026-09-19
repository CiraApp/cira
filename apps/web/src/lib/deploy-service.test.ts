import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { DEFAULT_LIMITS, newId, type User } from "@cira/core";
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
const told: Array<{ processes: unknown[] }> = [];
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
      deploy: (input: { processes: unknown[] }) => {
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

  const deploy = async (appName: string) => {
    const { deployToSpace } = await import("./deploy-service");
    return deployToSpace({
      user: deployer,
      spaceSlug: "paradym",
      appName,
      appId: null,
      sourceId: "src_1",
      framework: "unknown",
      container: null,
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

  it("marks the app failed when the builder refuses, and keeps its grant", async () => {
    providerFails = true;
    const outcome = await deploy("Broken");
    providerFails = false;

    expect(outcome.ok).toBe(false);

    const { apps, appAccess } = await import("@cira/db");
    const [app] = await database
      .select()
      .from(apps)
      .where(and(eq(apps.spaceId, spaceId), eq(apps.slug, "broken")))
      .limit(1);

    expect(app?.status).toBe("failed");

    // A failed build is not a reason for its owner to lose the app.
    const grants = await database
      .select()
      .from(appAccess)
      .where(eq(appAccess.appId, app?.id ?? ""));
    expect(grants).toHaveLength(1);
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
