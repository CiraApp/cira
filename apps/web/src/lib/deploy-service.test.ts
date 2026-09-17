import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { newId, type User } from "@cira/core";
import type * as CiraDb from "@cira/db";
import type * as CiraDeploy from "@cira/deploy";
import { createTestDatabase } from "../../../../packages/db/src/testing.js";

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

let database: ReturnType<typeof createTestDatabase>;
/** Flipped by a test that wants the provider to refuse. */
let providerFails = false;

async function makeDatabase() {
  const { randomUUID } = await import("node:crypto");
  const { readFileSync, readdirSync } = await import("node:fs");
  const { join } = await import("node:path");

  const namespace = `cira_deploy_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const admin = createTestDatabase(TEST_DATABASE_URL as string);
  await admin.execute(sql.raw(`drop schema if exists ${namespace} cascade`));
  await admin.execute(sql.raw(`create schema ${namespace}`));
  await admin.end();

  const db = createTestDatabase(TEST_DATABASE_URL as string, namespace);
  const dir = join(process.cwd(), "packages", "db", "migrations");
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const body = readFileSync(join(dir, file), "utf8").replaceAll(
      '"public".',
      `"${namespace}".`,
    );
    for (const statement of body.split("--> statement-breakpoint")) {
      if (statement.trim() !== "") await db.execute(sql.raw(statement));
    }
  }
  return db;
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
      deploy: () =>
        providerFails
          ? Promise.reject(new Error("the builder said no"))
          : Promise.resolve({
              providerDeploymentId: "prov_1",
              status: "building",
              url: null,
            }),
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
});
