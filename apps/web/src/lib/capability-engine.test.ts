import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { newId, type User } from "@cira/core";
import { NO_SUCH_CAPABILITY } from "./capabilities";
import type * as CiraDb from "@cira/db";
import type * as CiraDeploy from "@cira/deploy";
import { createTestDatabase } from "../../../../packages/db/src/testing.js";

/**
 * The capability engine end to end: an agent searches, describes, and invokes,
 * and a real HTTP app answers.
 *
 * Only two things are swapped. The database driver, because Neon speaks HTTP
 * and cannot reach a local Postgres; and the minting of the identity token
 * Cira opens an app with, because Google is not here. Everything else is real:
 * the schema, every permission check, the input validation, the target
 * resolution and the outbound request.
 *
 * The app on the other end is a real server that refuses anything arriving
 * without a token addressed to it - which stands in for Cloud Run, where that
 * check happens before the app is reached at all, and is what makes "it got to
 * the right place carrying the right thing" something this test can observe.
 */

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];
const hasDatabase = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== "";

const APP_PORT = 4611;
const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;
/** What the stubbed provider mints, and therefore what the app demands. */
const tokenFor = (audience: string): string => `id-token-for-${audience}`;

let database: Awaited<ReturnType<typeof makeDatabase>>;

async function makeDatabase() {
  const { randomUUID } = await import("node:crypto");
  const { readFileSync, readdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { sql } = await import("drizzle-orm");

  const namespace = `cira_engine_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

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

// Swapping only `db()`: every other export, the schema included, stays real.
vi.mock("@cira/db", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDb>();
  return { ...actual, db: () => database };
});

// Likewise only the token. Minting a real one needs Google, and what is worth
// testing here is that Cira asks for one addressed to this app and sends it -
// not that Google can sign.
vi.mock("@cira/deploy", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDeploy>();
  return {
    ...actual,
    deploymentProvider: () => ({
      invocationToken: (audience: string) => Promise.resolve(`id-token-for-${audience}`),
    }),
  };
});

let app: Server;
const received: Array<{ method: string; url: string; headers: Record<string, unknown> }> =
  [];

const employee: User = {
  id: newId("user"),
  name: "Dana",
  email: "dana@demo.test",
  createdAt: new Date(),
};
const outsider: User = {
  id: newId("user"),
  name: "Eve",
  email: "eve@other.test",
  createdAt: new Date(),
};
const founder: User = {
  id: newId("user"),
  name: "Aum",
  email: "aum@demo.test",
  createdAt: new Date(),
};

const spaceId = newId("space");
const appId = newId("app");
const revenueId = newId("capability");
const refundId = newId("capability");

describe.skipIf(!hasDatabase)("capability engine", () => {
  beforeAll(async () => {
    database = await makeDatabase();

    const { appAccess, apps, capabilities, deployments, memberships, spaces, users } =
      await import("@cira/db");

    await database.insert(users).values([
      { id: founder.id, externalId: "x1", name: "Aum", email: founder.email },
      { id: employee.id, externalId: "x2", name: "Dana", email: employee.email },
      { id: outsider.id, externalId: "x3", name: "Eve", email: outsider.email },
    ]);
    await database
      .insert(spaces)
      .values({ id: spaceId, name: "Demo", slug: "demo", domain: "demo.test" });
    await database.insert(memberships).values([
      { id: newId("membership"), userId: founder.id, spaceId, role: "owner" },
      { id: newId("membership"), userId: employee.id, spaceId, role: "member" },
    ]);
    await database.insert(apps).values({
      id: appId,
      spaceId,
      name: "Revenue Dashboard",
      slug: "revenue-dashboard",
      status: "live",
      ownerUserId: founder.id,
    });
    await database
      .insert(appAccess)
      .values({ id: newId("access"), appId, type: "user", targetId: employee.id });
    await database.insert(deployments).values({
      id: newId("deployment"),
      appId,
      provider: "vercel",
      providerDeploymentId: "dpl_demo",
      status: "live",
      url: APP_ORIGIN,
    });
    await database.insert(capabilities).values([
      {
        id: revenueId,
        appId,
        spaceId,
        name: "getRevenue",
        description: "Total revenue between two dates.",
        inputSchema: {
          type: "object",
          properties: { startDate: { type: "string" }, endDate: { type: "string" } },
          required: ["startDate", "endDate"],
        },
        method: "GET",
        path: "/api/revenue",
        risk: "read",
        confidence: 0.93,
        enabled: true,
      },
      {
        id: refundId,
        appId,
        spaceId,
        name: "createRefund",
        description: "Refund a payment.",
        inputSchema: { type: "object", properties: {}, required: [] },
        method: "POST",
        path: "/api/refunds",
        risk: "destructive",
        confidence: 0.9,
        enabled: false,
      },
    ]);

    app = createServer((request, response) => {
      const url = new URL(request.url ?? "/", APP_ORIGIN);
      received.push({
        method: request.method ?? "",
        url: request.url ?? "",
        headers: request.headers as Record<string, unknown>,
      });

      // A deployed app is unreachable except through Cira. Cloud Run makes
      // that true by checking the token's audience before the app sees the
      // request; this stands in for it, because answering anything without a
      // token addressed here would make the rest of this test meaningless.
      if (
        request.headers["x-serverless-authorization"] !== `Bearer ${tokenFor(APP_ORIGIN)}`
      ) {
        response.writeHead(401).end(JSON.stringify({ error: "unauthorized" }));
        return;
      }

      if (url.pathname === "/api/revenue") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            total: 482913.55,
            currency: "USD",
            startDate: url.searchParams.get("startDate"),
            endDate: url.searchParams.get("endDate"),
          }),
        );
        return;
      }

      if (url.pathname === "/api/html") {
        response.writeHead(200, { "content-type": "text/html" }).end("<html>hi</html>");
        return;
      }

      response.writeHead(404).end(JSON.stringify({ error: "not found" }));
    });

    await new Promise<void>((resolve) => app.listen(APP_PORT, "127.0.0.1", resolve));
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => app?.close(() => resolve()));
    await database?.end();
  });

  it("walks search, describe and invoke the way an agent would", async () => {
    const { runTool } = await import("./mcp");

    // 1. The agent looks for what it needs.
    const search = await runTool(employee, "search_capabilities", {
      query: "company revenue",
    });
    expect(search.isError).toBe(false);
    const found = JSON.parse(search.content) as {
      capabilities: Array<{ capabilityId: string; name: string }>;
    };
    expect(found.capabilities.map((c) => c.name)).toContain(
      "revenue-dashboard.getRevenue",
    );

    const id = found.capabilities.find((c) =>
      c.name.endsWith("getRevenue"),
    )?.capabilityId;
    expect(id).toBe(revenueId);

    // 2. It reads the input contract.
    const described = await runTool(employee, "describe_capability", {
      capabilityId: id,
    });
    expect(described.isError).toBe(false);
    const detail = JSON.parse(described.content) as {
      inputSchema: { required: string[] };
      method: string;
    };
    expect(detail.method).toBe("GET");
    expect(detail.inputSchema.required).toEqual(["startDate", "endDate"]);

    // 3. It calls it, and the real app answers.
    received.length = 0;
    const invoked = await runTool(employee, "invoke_capability", {
      capabilityId: id,
      input: { startDate: "2026-08-01", endDate: "2026-08-31" },
    });
    expect(invoked.isError).toBe(false);
    expect(JSON.parse(invoked.content)).toEqual({
      total: 482913.55,
      currency: "USD",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });

    // It reached the right route, carrying a token minted for this app alone.
    const hit = received[0];
    expect(hit?.method).toBe("GET");

    // Compared as parameters rather than as a string: schemas are stored as
    // jsonb, which sorts its keys, so the order they come back in is Postgres's
    // and not the one they were written in.
    const sent = new URL(hit?.url ?? "", APP_ORIGIN);
    expect(sent.pathname).toBe("/api/revenue");
    expect(Object.fromEntries(sent.searchParams)).toEqual({
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    expect(hit?.headers["x-cira-capability"]).toBe("getRevenue");

    // Not `authorization`: Cloud Run consumes this header and leaves the app's
    // own alone, which matters when the app was not written for Cira.
    expect(hit?.headers["x-serverless-authorization"]).toBe(
      `Bearer ${tokenFor(APP_ORIGIN)}`,
    );
    expect(hit?.headers["authorization"]).toBeUndefined();
  });

  it("hides a capability from someone who cannot open the app", async () => {
    const { runTool } = await import("./mcp");

    const search = await runTool(outsider, "search_capabilities", { query: "revenue" });
    expect(search.content).toContain("No capabilities match");

    const described = await runTool(outsider, "describe_capability", {
      capabilityId: revenueId,
    });
    expect(described).toEqual({ content: NO_SUCH_CAPABILITY, isError: true });
  });

  it("gives a missing capability and a forbidden one the very same answer", async () => {
    const { runTool } = await import("./mcp");

    const forbidden = await runTool(outsider, "describe_capability", {
      capabilityId: revenueId,
    });
    const missing = await runTool(outsider, "describe_capability", {
      capabilityId: "cap_00000000000000000000000000000000",
    });

    // If these ever differ, a capability id becomes a way to learn what a
    // company runs without being able to call any of it.
    expect(forbidden.content).toBe(missing.content);
    expect(forbidden.content).toBe(NO_SUCH_CAPABILITY);
  });

  it("refuses to invoke for someone who cannot open the app, even with the id", async () => {
    const { runTool } = await import("./mcp");
    received.length = 0;

    const invoked = await runTool(outsider, "invoke_capability", {
      capabilityId: revenueId,
      input: { startDate: "2026-08-01", endDate: "2026-08-31" },
    });

    expect(invoked.isError).toBe(true);
    expect(invoked.content).toBe(NO_SUCH_CAPABILITY);
    // The app was never contacted at all.
    expect(received).toHaveLength(0);
  });

  it("refuses to invoke a capability that is registered but disabled", async () => {
    const { runTool } = await import("./mcp");
    received.length = 0;

    const invoked = await runTool(founder, "invoke_capability", {
      capabilityId: refundId,
      input: {},
    });

    expect(invoked.isError).toBe(true);
    expect(invoked.content).toContain("not enabled");
    expect(received).toHaveLength(0);
  });

  it("rejects input the schema does not allow, without calling the app", async () => {
    const { runTool } = await import("./mcp");
    received.length = 0;

    const missing = await runTool(employee, "invoke_capability", {
      capabilityId: revenueId,
      input: { startDate: "2026-08-01" },
    });
    expect(missing.isError).toBe(true);
    expect(missing.content).toContain("endDate is required");

    const wrongType = await runTool(employee, "invoke_capability", {
      capabilityId: revenueId,
      input: { startDate: 1, endDate: 2 },
    });
    expect(wrongType.isError).toBe(true);
    expect(wrongType.content).toContain("must be a string");

    expect(received).toHaveLength(0);
  });

  it("sends only the fields the capability described", async () => {
    const { runTool } = await import("./mcp");
    received.length = 0;

    await runTool(employee, "invoke_capability", {
      capabilityId: revenueId,
      input: { startDate: "2026-08-01", endDate: "2026-08-31", isAdmin: true },
    });

    expect(received[0]?.url).not.toContain("isAdmin");
  });

  it("cannot be steered at another host by rewriting the stored target", async () => {
    const { capabilities } = await import("@cira/db");
    const { eq } = await import("drizzle-orm");
    const { runTool } = await import("./mcp");

    // Simulates the worst case: something got a hostile value into the target
    // column. The path is re-checked immediately before the call, so it never
    // becomes a request.
    for (const path of ["https://evil.test/steal", "//evil.test/steal", "/api/../x"]) {
      await database
        .update(capabilities)
        .set({ path })
        .where(eq(capabilities.id, revenueId));

      const invoked = await runTool(employee, "invoke_capability", {
        capabilityId: revenueId,
        input: { startDate: "a", endDate: "b" },
      });
      expect(invoked.isError, path).toBe(true);
      expect(invoked.content, path).toContain("not reachable");
    }

    await database
      .update(capabilities)
      .set({ path: "/api/revenue" })
      .where(eq(capabilities.id, revenueId));
  });

  it("refuses a response that is not JSON rather than handing an agent a page", async () => {
    const { capabilities } = await import("@cira/db");
    const { eq } = await import("drizzle-orm");
    const { runTool } = await import("./mcp");

    await database
      .update(capabilities)
      .set({ path: "/api/html" })
      .where(eq(capabilities.id, revenueId));

    const invoked = await runTool(employee, "invoke_capability", {
      capabilityId: revenueId,
      input: { startDate: "a", endDate: "b" },
    });
    expect(invoked.isError).toBe(true);
    expect(invoked.content).toContain("did not return JSON");

    await database
      .update(capabilities)
      .set({ path: "/api/revenue" })
      .where(eq(capabilities.id, revenueId));
  });

  it("replaces the capability set on redeploy, keeping decisions people made", async () => {
    const { replaceCapabilities, listCapabilitiesForApp } =
      await import("./capabilities");

    // Someone reviewed createRefund and switched it on.
    const { capabilities } = await import("@cira/db");
    const { eq } = await import("drizzle-orm");
    await database
      .update(capabilities)
      .set({ enabled: true })
      .where(eq(capabilities.id, refundId));

    const counts = await replaceCapabilities({
      appId,
      spaceId,
      detected: [
        {
          name: "getRevenue",
          description: "Total revenue between two dates.",
          method: "GET",
          path: "/api/revenue",
          inputSchema: { type: "object", properties: {}, required: [] },
          outputSchema: null,
          risk: "read",
          confidence: 0.95,
        },
        {
          name: "createRefund",
          description: "Refund a payment.",
          method: "POST",
          path: "/api/refunds",
          inputSchema: { type: "object", properties: {}, required: [] },
          outputSchema: null,
          risk: "destructive",
          confidence: 0.9,
        },
        {
          name: "getMonthlyGrowth",
          description: "Month over month growth.",
          method: "GET",
          path: "/api/growth",
          inputSchema: { type: "object", properties: {}, required: [] },
          outputSchema: null,
          risk: "read",
          confidence: 0.91,
        },
      ],
    });

    const after = await listCapabilitiesForApp(appId);
    expect(after.map((c) => c.name).sort()).toEqual([
      "createRefund",
      "getMonthlyGrowth",
      "getRevenue",
    ]);

    // The reviewed decision survived; the new read turned itself on.
    expect(after.find((c) => c.name === "createRefund")?.enabled).toBe(true);
    expect(after.find((c) => c.name === "getMonthlyGrowth")?.enabled).toBe(true);
    expect(counts.enabled).toBe(3);

    // A capability whose code has gone stops existing.
    const shrunk = await replaceCapabilities({
      appId,
      spaceId,
      detected: [
        {
          name: "getRevenue",
          description: "Total revenue between two dates.",
          method: "GET",
          path: "/api/revenue",
          inputSchema: { type: "object", properties: {}, required: [] },
          outputSchema: null,
          risk: "read",
          confidence: 0.95,
        },
      ],
    });

    expect((await listCapabilitiesForApp(appId)).map((c) => c.name)).toEqual([
      "getRevenue",
    ]);
    expect(shrunk.review).toBe(0);
  });
});
