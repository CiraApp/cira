import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { newId, type Space, type User } from "@cira/core";
import type * as CiraDb from "@cira/db";
import type * as CiraDeploy from "@cira/deploy";
import { migratedTestDatabase } from "../../../../packages/db/src/test-database.js";

/**
 * Leaving: what a company takes with it, and what deleting actually deletes.
 * The rule that matters is that Google is told before Cira forgets - an app
 * still running that Cira no longer lists is one nobody knows to stop.
 */

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];
const hasDatabase = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== "";

let database: Awaited<ReturnType<typeof migratedTestDatabase>>;

vi.mock("@cira/db", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDb>();
  return { ...actual, db: () => database };
});

/** Which services Google was told to take down, and whether it refuses. */
const torn: string[] = [];
let googleRefuses = false;

vi.mock("@cira/deploy", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDeploy>();
  return {
    ...actual,
    deploymentProvider: () => ({
      teardown: (service: string) => {
        if (googleRefuses) return Promise.reject(new Error("busy"));
        torn.push(service);
        return Promise.resolve({ images: true });
      },
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
const appId = newId("app");
const otherAppId = newId("app");

describe.skipIf(!hasDatabase)("leaving Cira", () => {
  beforeEach(async () => {
    torn.length = 0;
    googleRefuses = false;
  });

  beforeAll(async () => {
    database = await migratedTestDatabase(TEST_DATABASE_URL as string, "cira_leaving");
    const {
      appEnvVars,
      apps,
      capabilities,
      deployments,
      memberships,
      processes,
      spaces,
      users,
    } = await import("@cira/db");
    await database
      .insert(users)
      .values({ id: owner.id, externalId: "l1", name: owner.name, email: owner.email });
    await database
      .insert(spaces)
      .values({ id: spaceId, name: "Acme", slug: "acme", domain: "acme.test" });
    await database
      .insert(memberships)
      .values({ id: newId("membership"), userId: owner.id, spaceId, role: "owner" });
    await database.insert(apps).values([
      { id: appId, spaceId, name: "Reports", slug: "reports", ownerUserId: owner.id },
      { id: otherAppId, spaceId, name: "Quiet", slug: "quiet", ownerUserId: owner.id },
    ]);
    await database.insert(deployments).values({
      id: newId("deployment"),
      appId,
      provider: "cloudrun",
      providerDeploymentId: "b1:acme-reports-0000app1:t1",
      status: "live",
    });
    await database.insert(capabilities).values({
      id: newId("capability"),
      spaceId,
      appId,
      name: "getRevenue",
      description: "Revenue between two dates.",
      inputSchema: { type: "object" },
      method: "GET",
      path: "/revenue",
      risk: "read",
    });
    await database.insert(processes).values({
      id: newId("process"),
      appId,
      spaceId,
      name: "worker",
      kind: "worker",
      command: "python worker.py",
      serviceSlug: "app",
      source: "Procfile",
    });
    await database.insert(appEnvVars).values({
      id: newId("access"),
      appId,
      key: "DATABASE_URL",
      fingerprint: "sha256:abc",
      isPublic: false,
      setByUserId: owner.id,
    });
  }, 60_000);

  afterAll(async () => {
    await database?.end();
  });

  it("exports what Cira holds, and nothing it promised not to", async () => {
    const { exportSpace } = await import("./space-export");
    const exported = await exportSpace(spaceId);
    expect(exported).not.toBeNull();
    if (exported === null) return;

    expect(exported.space).toMatchObject({
      name: "Acme",
      address: "/acme",
      plan: "trial",
    });
    expect(exported.people).toEqual([
      expect.objectContaining({ email: "owner@acme.test", role: "owner" }),
    ]);
    const reports = exported.apps.find((app) => app["name"] === "Reports");
    expect(reports).toMatchObject({ address: "/acme/reports", owner: "owner@acme.test" });
    expect(reports?.["capabilities"]).toEqual([
      expect.objectContaining({ name: "getRevenue", method: "GET" }),
    ]);
    expect(reports?.["processes"]).toEqual([
      expect.objectContaining({ name: "worker", kind: "worker" }),
    ]);

    // The names of an app's variables, never their values or fingerprints.
    expect(reports?.["environmentVariableNames"]).toEqual(["DATABASE_URL"]);
    expect(JSON.stringify(exported)).not.toContain("sha256:abc");
  });

  it("tells Google first, then forgets the company", async () => {
    const { tearDownSpace } = await import("./space-teardown");
    const { apps, spaces, capabilities } = await import("@cira/db");
    const [space] = await database.select().from(spaces).where(eq(spaces.id, spaceId));

    const result = await tearDownSpace(space as Space);
    expect(result).toEqual({ ok: true, apps: 2 });
    expect(torn).toEqual(["acme-reports-0000app1"]);

    expect(await database.select().from(spaces).where(eq(spaces.id, spaceId))).toEqual(
      [],
    );
    expect(await database.select().from(apps).where(eq(apps.spaceId, spaceId))).toEqual(
      [],
    );
    // Everything hanging off the space goes with it.
    expect(
      await database.select().from(capabilities).where(eq(capabilities.spaceId, spaceId)),
    ).toEqual([]);
  });

  it("deletes nothing when Google will not take an app down", async () => {
    const { tearDownSpace } = await import("./space-teardown");
    const { apps, spaces } = await import("@cira/db");
    const secondSpace = newId("space");
    await database
      .insert(spaces)
      .values({ id: secondSpace, name: "Still Here", slug: "still", domain: "s.test" });
    const stuck = newId("app");
    await database.insert(apps).values({
      id: stuck,
      spaceId: secondSpace,
      name: "Stuck",
      slug: "stuck",
      ownerUserId: owner.id,
    });
    const { deployments } = await import("@cira/db");
    await database.insert(deployments).values({
      id: newId("deployment"),
      appId: stuck,
      provider: "cloudrun",
      providerDeploymentId: "b1:still-stuck-0000app9:t1",
      status: "live",
    });

    googleRefuses = true;
    const [space] = await database
      .select()
      .from(spaces)
      .where(eq(spaces.id, secondSpace));
    const result = await tearDownSpace(space as Space);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("nothing was deleted");
    expect(
      await database.select().from(spaces).where(eq(spaces.id, secondSpace)),
    ).toHaveLength(1);
    expect(await database.select().from(apps).where(eq(apps.id, stuck))).toHaveLength(1);
  });
});
