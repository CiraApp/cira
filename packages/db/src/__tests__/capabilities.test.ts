import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  canInvokeCapability,
  newId,
  visibleCapabilities,
  type App,
  type AppAccess,
  type Capability,
  type Membership,
  type Principal,
} from "@cira/core";
import {
  appAccess,
  apps,
  capabilities,
  memberships,
  spaces,
  teamMembers,
  users,
} from "../schema.js";
import type { TestDatabase } from "../testing.js";
import { freshDatabase, hasDatabase } from "./harness.js";

/**
 * The capability engine's authorization, against a real database.
 *
 * A capability is a way to make an internal app do something without opening
 * it, so the expensive failure here is not a crash: it is an employee - or an
 * agent acting for one - reaching an operation in an app they were never given.
 * These assert what each person can discover and run, using the same rules the
 * registry and the MCP surface consult.
 */
describe.skipIf(!hasDatabase)("capability access", () => {
  let db: TestDatabase;

  const acme = newId("space");
  const founder = newId("user");
  const employee = newId("user");
  const outsider = newId("user");
  const revenueApp = newId("app");
  const payrollApp = newId("app");

  const getRevenue = newId("capability");
  const exportPayroll = newId("capability");
  const createRefund = newId("capability");

  beforeAll(async () => {
    db = await freshDatabase();

    await db.insert(users).values([
      { id: founder, externalId: "ext_f", name: "Aum", email: "aum@acme.com" },
      { id: employee, externalId: "ext_e", name: "Dana", email: "dana@acme.com" },
      { id: outsider, externalId: "ext_o", name: "Eve", email: "eve@other.com" },
    ]);
    await db
      .insert(spaces)
      .values({ id: acme, name: "Acme", slug: "acme", domain: "acme.com" });
    await db.insert(memberships).values([
      { id: newId("membership"), userId: founder, spaceId: acme, role: "owner" },
      { id: newId("membership"), userId: employee, spaceId: acme, role: "member" },
    ]);
    await db.insert(apps).values([
      {
        id: revenueApp,
        spaceId: acme,
        name: "Revenue",
        slug: "revenue",
        ownerUserId: founder,
        status: "live",
      },
      {
        id: payrollApp,
        spaceId: acme,
        name: "Payroll",
        slug: "payroll",
        ownerUserId: founder,
        status: "live",
      },
    ]);

    // Dana can open Revenue. Nobody gave her Payroll.
    await db.insert(appAccess).values({
      id: newId("access"),
      appId: revenueApp,
      type: "user",
      targetId: employee,
    });

    const schema = { type: "object", properties: {}, required: [] };
    await db.insert(capabilities).values([
      {
        id: getRevenue,
        appId: revenueApp,
        spaceId: acme,
        name: "getRevenue",
        description: "Revenue for a date range.",
        inputSchema: schema,
        method: "GET",
        path: "/api/revenue",
        risk: "read",
        confidence: 0.92,
        enabled: true,
      },
      {
        id: createRefund,
        appId: revenueApp,
        spaceId: acme,
        name: "createRefund",
        description: "Refund a payment.",
        inputSchema: schema,
        method: "POST",
        path: "/api/refunds",
        risk: "write",
        confidence: 0.9,
        enabled: false,
      },
      {
        id: exportPayroll,
        appId: payrollApp,
        spaceId: acme,
        name: "exportPayroll",
        description: "Export the payroll run.",
        inputSchema: schema,
        method: "GET",
        path: "/api/payroll",
        risk: "read",
        confidence: 0.95,
        enabled: true,
      },
    ]);
  }, 60_000);

  afterAll(async () => {
    await db?.end();
  });

  async function context() {
    // As Cira reads them: the method and path are one target, and only the
    // two grades the rest of the code knows.
    const capabilityRows: Capability[] = (await db.select().from(capabilities)).map(
      (row) => ({
        id: row.id,
        spaceId: row.spaceId,
        appId: row.appId,
        name: row.name,
        description: row.description,
        inputSchema: row.inputSchema as Record<string, unknown>,
        outputSchema: (row.outputSchema as Record<string, unknown> | null) ?? null,
        target: { type: "http", method: row.method, path: row.path },
        risk: row.risk === "read" ? "read" : "write",
        enabled: row.enabled,
        reach: row.reach,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }),
    );
    const appRows = (await db.select().from(apps)) as App[];
    const memberRows = (await db.select().from(memberships)) as Membership[];
    const grantRows = (await db.select().from(appAccess)) as AppAccess[];
    const teamRows = await db.select().from(teamMembers);
    return { capabilityRows, appRows, memberRows, grantRows, teamRows };
  }

  function who(
    userId: string,
    memberRows: Membership[],
    teamRows: Array<{ teamId: string; userId: string }>,
  ): Principal {
    return {
      userId,
      memberships: memberRows,
      teamIds: teamRows.filter((t) => t.userId === userId).map((t) => t.teamId),
    };
  }

  async function discoverableBy(userId: string) {
    const { capabilityRows, appRows, memberRows, grantRows, teamRows } = await context();
    return visibleCapabilities({
      principal: who(userId, memberRows, teamRows),
      capabilities: capabilityRows,
      apps: appRows,
      access: grantRows,
    }).map((c) => c.name);
  }

  async function canRun(userId: string, capabilityId: string) {
    const { capabilityRows, appRows, memberRows, grantRows, teamRows } = await context();
    const capability = capabilityRows.find((c) => c.id === capabilityId);
    const app = appRows.find((a) => a.id === capability?.appId);
    if (capability === undefined || app === undefined) return false;
    return canInvokeCapability({
      principal: who(userId, memberRows, teamRows),
      capability,
      app,
      access: grantRows,
    });
  }

  it("shows an employee only the capabilities of apps they were given", async () => {
    expect((await discoverableBy(employee)).sort()).toEqual([
      "createRefund",
      "getRevenue",
    ]);
  });

  it("shows the owner every capability in the space", async () => {
    expect((await discoverableBy(founder)).sort()).toEqual([
      "createRefund",
      "exportPayroll",
      "getRevenue",
    ]);
  });

  it("shows someone outside the company nothing at all", async () => {
    expect(await discoverableBy(outsider)).toEqual([]);
  });

  it("lets an authorized employee run an enabled capability", async () => {
    expect(await canRun(employee, getRevenue)).toBe(true);
  });

  it("refuses to run a capability on an app the person cannot open", async () => {
    // Discovery already hid it; this is the second gate, so that a leaked id
    // is still not a way in.
    expect(await canRun(employee, exportPayroll)).toBe(false);
    expect(await canRun(outsider, getRevenue)).toBe(false);
  });

  it("refuses to run a capability that is registered but not enabled", async () => {
    expect(await discoverableBy(employee)).toContain("createRefund");
    expect(await canRun(employee, createRefund)).toBe(false);
    expect(await canRun(founder, createRefund)).toBe(false);
  });

  it("stops discovery the moment access is revoked", async () => {
    await db.delete(appAccess).where(eq(appAccess.appId, revenueApp));
    expect(await discoverableBy(employee)).toEqual([]);
    expect(await canRun(employee, getRevenue)).toBe(false);
  });

  it("takes an app's capabilities with it when the app is deleted", async () => {
    await db.delete(apps).where(eq(apps.id, payrollApp));
    const left = await db.select().from(capabilities);
    expect(left.map((c) => c.name).sort()).toEqual(["createRefund", "getRevenue"]);
  });
});
