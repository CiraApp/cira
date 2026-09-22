import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { DEFAULT_LIMITS, newId, type User } from "@cira/core";
import { NO_SUCH_CAPABILITY } from "./capabilities";
import type * as CiraDb from "@cira/db";
import type * as CiraDeploy from "@cira/deploy";
import { migratedTestDatabase } from "../../../../packages/db/src/test-database.js";

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

/** `runTool` as the MCP route calls it, with the surface named only where it matters. */
async function toolsAs() {
  const { runTool } = await import("./mcp");
  return (
    user: User,
    name: string,
    args: Record<string, unknown>,
    via: "mcp" | "ask" | "console" = "mcp",
  ) => runTool(user, name, args, { via, origin: "https://cira.test" });
}

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];
const hasDatabase = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== "";

const APP_PORT = 4611;
const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;
/** What the stubbed provider mints, and therefore what the app demands. */
const tokenFor = (audience: string): string => `id-token-for-${audience}`;

let database: Awaited<ReturnType<typeof makeDatabase>>;

async function makeDatabase() {
  return migratedTestDatabase(TEST_DATABASE_URL as string, "cira_engine");
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

// The console's action asks the session who is signed in; there is no session
// here, so the test says who it is. Nothing else about identity is swapped.
let signedIn: User | null = null;
vi.mock("@/lib/identity", () => ({
  getCurrentUser: () => Promise.resolve(signedIn),
  requireCurrentUser: () => Promise.resolve(signedIn),
}));

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

/** Administers the space, with no grant on the app and no ownership of it. */
const admin: User = {
  id: newId("user"),
  name: "Ines",
  email: "ines@demo.test",
  createdAt: new Date(),
};
/** In the space, and given nothing. */
const bystander: User = {
  id: newId("user"),
  name: "Bo",
  email: "bo@demo.test",
  createdAt: new Date(),
};

const spaceId = newId("space");
const appId = newId("app");
const revenueId = newId("capability");
const refundId = newId("capability");
const deploymentId = newId("deployment");

describe.skipIf(!hasDatabase)("capability engine", () => {
  beforeAll(async () => {
    database = await makeDatabase();

    const { appAccess, apps, capabilities, deployments, memberships, spaces, users } =
      await import("@cira/db");

    await database.insert(users).values([
      { id: founder.id, externalId: "x1", name: "Aum", email: founder.email },
      { id: employee.id, externalId: "x2", name: "Dana", email: employee.email },
      { id: outsider.id, externalId: "x3", name: "Eve", email: outsider.email },
      { id: admin.id, externalId: "x4", name: "Ines", email: admin.email },
      { id: bystander.id, externalId: "x5", name: "Bo", email: bystander.email },
    ]);
    await database
      .insert(spaces)
      .values({ id: spaceId, name: "Demo", slug: "demo", domain: "demo.test" });
    await database.insert(memberships).values([
      { id: newId("membership"), userId: founder.id, spaceId, role: "owner" },
      { id: newId("membership"), userId: employee.id, spaceId, role: "member" },
      { id: newId("membership"), userId: admin.id, spaceId, role: "admin" },
      { id: newId("membership"), userId: bystander.id, spaceId, role: "member" },
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
      id: deploymentId,
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
        // Seeded as already confirmed by the app: anything the app has not
        // said yes to is deliberately invisible, which would make every case
        // below vacuous.
        verifiedAt: new Date(),
        reach: "callable" as const,
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
        risk: "write",
        // Seeded as already confirmed by the app: anything the app has not
        // said yes to is deliberately invisible, which would make every case
        // below vacuous.
        verifiedAt: new Date(),
        reach: "callable" as const,
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

      // Behind the app's own sign-in: Cira's token opens the door to the
      // service, and the app then asks who is calling. Answers a method
      // probe first, the way real frameworks do, which is why nothing short
      // of the real call can tell this apart from a route that works.
      if (url.pathname === "/api/locked") {
        if (request.method === "OPTIONS") {
          response.writeHead(405, { allow: "GET, POST" }).end();
          return;
        }
        response.writeHead(401).end(JSON.stringify({ error: "sign in" }));
        return;
      }

      // An id in the path, the way most REST routes carry one.
      if (url.pathname.startsWith("/api/orders/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/orders/".length));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ id, query: Object.fromEntries(url.searchParams) }));
        return;
      }

      // An app failing in its own words, which a person needs to see as-is.
      if (url.pathname === "/api/broken") {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "the ledger database is down" }));
        return;
      }

      // Says back exactly what arrived: the body as bytes decoded, and every
      // query value, repeated keys included.
      if (url.pathname === "/api/echo") {
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              body: raw === "" ? null : (JSON.parse(raw) as unknown),
              declared: request.headers["content-length"] ?? null,
              received: Buffer.concat(chunks).byteLength,
              tags: url.searchParams.getAll("tag"),
            }),
          );
        });
        return;
      }

      // A write that worked, answered the way plain web apps answer a form.
      if (url.pathname === "/api/after-write") {
        response.writeHead(303, { location: "/orders/1" }).end();
        return;
      }
      // A lookup by query that has nothing to return, in its own words.
      if (url.pathname === "/api/lookup") {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "no order with that id" }));
        return;
      }
      if (url.pathname === "/api/html-write") {
        response.writeHead(200, { "content-type": "text/html" }).end("<p>Saved</p>");
        return;
      }

      if (url.pathname === "/api/payouts" && request.method === "POST") {
        response.writeHead(201, { "content-type": "application/json" });
        response.end(JSON.stringify({ paid: true }));
        return;
      }

      if (url.pathname === "/api/html") {
        response.writeHead(200, { "content-type": "text/html" }).end("<html>hi</html>");
        return;
      }

      response.writeHead(404).end(JSON.stringify({ error: "not found" }));
    });

    await new Promise<void>((resolve) => app.listen(APP_PORT, "127.0.0.1", resolve));

    // Loaded here, under this hook's allowance, rather than by whichever test
    // happens to run first: transforming the agent surface's whole module
    // graph took most of a test's five seconds on a busy machine.
    await import("./mcp");
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => app?.close(() => resolve()));
    await database?.end();
  });

  it("walks search, describe and invoke the way an agent would", async () => {
    const runTool = await toolsAs();

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
    const runTool = await toolsAs();

    const search = await runTool(outsider, "search_capabilities", { query: "revenue" });
    expect(search.content).toContain("No capabilities match");

    const described = await runTool(outsider, "describe_capability", {
      capabilityId: revenueId,
    });
    expect(described).toEqual({ content: NO_SUCH_CAPABILITY, isError: true });
  });

  // Ask Cira is opened inside one space. A person in two used to get the
  // other company's apps mixed into its answers.
  it("keeps a surface opened in one space to that space", async () => {
    const { runTool } = await import("./mcp");
    const elsewhere = {
      via: "ask" as const,
      origin: "https://cira.test",
      inSpace: "globex",
    };
    const here = { ...elsewhere, inSpace: "demo" };

    const search = await runTool(
      employee,
      "search_capabilities",
      { query: "revenue" },
      here,
    );
    expect(search.content).toContain("getRevenue");

    const away = await runTool(employee, "search_capabilities", { query: "" }, elsewhere);
    expect(away.content).not.toContain("getRevenue");
    const invoked = await runTool(
      employee,
      "invoke_capability",
      {
        capabilityId: revenueId,
        input: { startDate: "2026-01-01", endDate: "2026-01-31" },
      },
      elsewhere,
    );
    expect(invoked).toEqual({ content: NO_SUCH_CAPABILITY, isError: true });
    const status = await runTool(employee, "app_status", { app: "" }, elsewhere);
    expect(status.content).not.toContain("Revenue Dashboard");
  });

  it("gives a missing capability and a forbidden one the very same answer", async () => {
    const runTool = await toolsAs();

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
    const runTool = await toolsAs();
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
    const runTool = await toolsAs();
    received.length = 0;

    const invoked = await runTool(founder, "invoke_capability", {
      capabilityId: refundId,
      input: {},
    });

    expect(invoked.isError).toBe(true);
    expect(invoked.content).toContain("not enabled");
    expect(received).toHaveLength(0);
  });

  /**
   * The whole point of the third state, seen from where it matters.
   *
   * A capability the app itself refuses reads as `enabled: false`, and an
   * agent that sees only that concludes an admin can switch it on. The first
   * agent to meet this spent its closing turns recommending exactly that,
   * about an app where no such switch exists. So the refusal has to say what
   * it is, and it has to say so in search as well as on invocation - an agent
   * that has to call a capability to find out it cannot call it has already
   * wasted the turn.
   */
  it("tells an agent a refused capability is the app's doing, not a missing switch", async () => {
    const runTool = await toolsAs();
    const { recordVerification } = await import("./capabilities");
    received.length = 0;

    await recordVerification({
      appId,
      deploymentId,
      callable: [],
      refused: ["getRevenue"],
      absent: [],
    });

    // In a finally, because these cases share one app and one database: a
    // failure here would otherwise leave getRevenue refused and take five
    // later cases down with it, which is a cascade that hides whichever
    // assertion actually broke.
    try {
      const search = await runTool(employee, "search_capabilities", { query: "revenue" });
      const listed = JSON.parse(search.content) as {
        capabilities: Array<{ name: string; enabled: boolean; unavailable?: string }>;
      };
      const found = listed.capabilities.find((c) => c.name.endsWith("getRevenue"));
      expect(found?.enabled).toBe(false);
      expect(found?.unavailable).toContain("signs");
      expect(found?.unavailable).toContain("do not suggest enabling it");

      const invoked = await runTool(employee, "invoke_capability", {
        capabilityId: revenueId,
        input: { startDate: "2026-08-01", endDate: "2026-08-31" },
      });

      expect(invoked.isError).toBe(true);
      expect(invoked.content).toContain("will not let Cira call it");
      // And crucially not the sentence that sends someone to an admin.
      expect(invoked.content).not.toContain("An admin can turn it on");
      // The app is never contacted, because the answer is already known.
      expect(received).toHaveLength(0);
    } finally {
      await recordVerification({
        appId,
        deploymentId,
        callable: ["getRevenue"],
        refused: [],
        absent: [],
      });
    }
  });

  it("rejects input the schema does not allow, without calling the app", async () => {
    const runTool = await toolsAs();
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
    const runTool = await toolsAs();
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
    const runTool = await toolsAs();

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
    const runTool = await toolsAs();

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
        },
        {
          name: "createRefund",
          description: "Refund a payment.",
          method: "POST",
          path: "/api/refunds",
          inputSchema: { type: "object", properties: {}, required: [] },
          outputSchema: null,
          risk: "write",
        },
        {
          name: "getMonthlyGrowth",
          description: "Month over month growth.",
          method: "GET",
          path: "/api/growth",
          inputSchema: { type: "object", properties: {}, required: [] },
          outputSchema: null,
          risk: "read",
        },
      ],
    });

    const after = await listCapabilitiesForApp(appId);
    expect(after.map((c) => c.name).sort()).toEqual([
      "createRefund",
      "getMonthlyGrowth",
      "getRevenue",
    ]);

    // The reviewed decision survived a redeploy, which is the rule this test
    // exists for: re-detecting createRefund must not switch it back off.
    expect(after.find((c) => c.name === "createRefund")?.enabled).toBe(true);

    // The new read is registered but not yet live. Policy says a read may turn
    // itself on; nothing has asked the running app whether it serves the route,
    // and until something has, an agent is not offered it.
    expect(after.find((c) => c.name === "getMonthlyGrowth")?.enabled).toBe(false);
    expect(counts.enabled).toBe(3);

    // Once the app answers for it, it is live - without anyone reviewing it,
    // because it only reads.
    const { recordVerification } = await import("./capabilities");
    await recordVerification({
      appId,
      deploymentId,
      callable: ["getMonthlyGrowth"],
      refused: [],
      absent: [],
    });
    const confirmed = await listCapabilitiesForApp(appId);
    expect(confirmed.find((c) => c.name === "getMonthlyGrowth")?.enabled).toBe(true);

    // One the app serves and will not let Cira through is kept and switched
    // off, rather than deleted. The route is real and the description of it is
    // right; the only thing missing is a way in, and deleting it would throw
    // away a true account of the app and leave the page nothing to explain.
    await recordVerification({
      appId,
      deploymentId,
      callable: [],
      refused: ["getMonthlyGrowth"],
      absent: [],
    });
    const shut = await listCapabilitiesForApp(appId);
    const barred = shut.find((c) => c.name === "getMonthlyGrowth");
    expect(barred?.reach).toBe("refused");
    expect(barred?.enabled).toBe(false);

    // And one the app has no route for stops existing at all.
    await recordVerification({
      appId,
      deploymentId,
      callable: [],
      refused: [],
      absent: ["getMonthlyGrowth"],
    });
    expect((await listCapabilitiesForApp(appId)).map((c) => c.name)).not.toContain(
      "getMonthlyGrowth",
    );

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
        },
      ],
    });

    expect((await listCapabilitiesForApp(appId)).map((c) => c.name)).toEqual([
      "getRevenue",
    ]);
    expect(shrunk.review).toBe(0);
  });

  /**
   * Found while building the console: invocation never filled path
   * parameters. `/api/orders/{order_id}` went out with the braces in it and the
   * id riding along as a query parameter, so every capability with an id in
   * its path answered 404. Verification filled them; calling did not.
   */
  it("puts path parameters into the address and sends them nowhere else", async () => {
    const { capabilities } = await import("@cira/db");
    const { eq } = await import("drizzle-orm");
    const { invokeCapability } = await import("./invoke-capability");
    const id = newId("capability");

    await database.insert(capabilities).values({
      id,
      appId,
      spaceId,
      name: "getOrder",
      description: "One order.",
      inputSchema: {
        type: "object",
        properties: { order_id: { type: "string" }, expand: { type: "string" } },
        required: ["order_id"],
      },
      method: "GET",
      path: "/api/orders/{order_id}",
      risk: "read",
      enabled: true,
      reach: "callable",
      answeredBy: deploymentId,
      verifiedAt: new Date(),
    });

    try {
      const result = await invokeCapability({
        user: employee,
        capabilityId: id,
        input: { order_id: "ord 7/x", expand: "lines" },
        via: "mcp",
      });

      expect(result.ok).toBe(true);
      // Encoded into the address, and not repeated in the query.
      expect(result.ok && result.data).toEqual({
        id: "ord 7/x",
        query: { expand: "lines" },
      });

      const escape = await invokeCapability({
        user: employee,
        capabilityId: id,
        input: { order_id: ".." },
        via: "mcp",
      });
      expect(escape.ok).toBe(false);
    } finally {
      await database.delete(capabilities).where(eq(capabilities.id, id));
    }
  });

  it("keeps what the app said when it fails, and still says why in a sentence", async () => {
    const { capabilities } = await import("@cira/db");
    const { eq } = await import("drizzle-orm");
    const { invokeCapability } = await import("./invoke-capability");
    const runTool = await toolsAs();
    const id = newId("capability");

    await database.insert(capabilities).values({
      id,
      appId,
      spaceId,
      name: "readLedgerTotals",
      description: "Ledger totals.",
      inputSchema: { type: "object", properties: {}, required: [] },
      method: "GET",
      path: "/api/broken",
      risk: "read",
      enabled: true,
      reach: "callable",
      answeredBy: deploymentId,
      verifiedAt: new Date(),
    });

    try {
      const result = await invokeCapability({
        user: employee,
        capabilityId: id,
        input: {},
        via: "mcp",
      });
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error).toBe("readLedgerTotals failed (500).");
      // The app's own words, for a person.
      expect(result.answer?.status).toBe(500);
      expect(JSON.parse(result.answer?.body ?? "{}")).toEqual({
        error: "the ledger database is down",
      });
      expect(result.answer?.elapsedMs).toBeGreaterThanOrEqual(0);

      // An agent is told exactly what it was told before.
      const tool = await runTool(employee, "invoke_capability", {
        capabilityId: id,
        input: {},
      });
      expect(tool).toEqual({ content: "readLedgerTotals failed (500).", isError: true });
    } finally {
      await database.delete(capabilities).where(eq(capabilities.id, id));
    }
  });

  /**
   * The one-way door. A developer sees "Refused", lets Cira in, and deploys
   * again; every route keeps its path, so nothing used to put these back in
   * front of the app, and the page went on saying they were shut.
   */
  it("asks again about a refusal once a newer build is serving", async () => {
    const { capabilities, deployments } = await import("@cira/db");
    const { eq } = await import("drizzle-orm");
    const { listCapabilitiesForApp } = await import("./capabilities");
    const { verifyAppCapabilities } = await import("./capability-verification");

    const ledgerId = newId("capability");
    const nextBuild = newId("deployment");

    await database.insert(capabilities).values({
      id: ledgerId,
      appId,
      spaceId,
      name: "readLedger",
      description: "The ledger.",
      inputSchema: { type: "object", properties: {}, required: [] },
      method: "GET",
      path: "/api/revenue",
      risk: "read",
      enabled: true,
      reach: "refused",
      answeredBy: deploymentId,
      verifiedAt: new Date(),
    });

    try {
      const shut = await listCapabilitiesForApp(appId);
      expect(shut.find((c) => c.id === ledgerId)?.reach).toBe("refused");

      // The same app, redeployed. Nothing about the capability changed.
      await database.insert(deployments).values({
        id: nextBuild,
        appId,
        provider: "vercel",
        providerDeploymentId: "dpl_next",
        status: "live",
        url: APP_ORIGIN,
        createdAt: new Date(Date.now() + 60_000),
      });

      // Every reader now sees it as unanswered, which is what makes the
      // page's own self-heal ask - no reset had to be remembered anywhere.
      const aged = (await listCapabilitiesForApp(appId)).find((c) => c.id === ledgerId);
      expect(aged?.reach).toBe("pending");
      expect(aged?.enabled).toBe(false);

      // And asking settles it against the build that is serving now.
      const outcome = await verifyAppCapabilities(appId);
      expect(outcome.ok).toBe(true);

      const [row] = await database
        .select()
        .from(capabilities)
        .where(eq(capabilities.id, ledgerId));
      expect(row?.reach).toBe("callable");
      expect(row?.answeredBy).toBe(nextBuild);
    } finally {
      await database.delete(capabilities).where(eq(capabilities.id, ledgerId));
      await database.delete(deployments).where(eq(deployments.id, nextBuild));
    }
  });

  it("asks again after a deploy about what worked, and tells its managers when it stopped", async () => {
    const { capabilities, deployments, notifications } = await import("@cira/db");
    const { and, eq } = await import("drizzle-orm");
    const { verifyAppCapabilities } = await import("./capability-verification");

    const lockedId = newId("capability");
    const nextBuild = newId("deployment");

    // Worked under the build before: the new one put it behind a sign-in.
    await database.insert(capabilities).values({
      id: lockedId,
      appId,
      spaceId,
      name: "readLocked",
      description: "Something behind a sign-in added in the new build.",
      inputSchema: { type: "object", properties: {}, required: [] },
      method: "GET",
      path: "/api/locked",
      risk: "read",
      enabled: true,
      reach: "callable",
      answeredBy: deploymentId,
      verifiedAt: new Date(),
    });
    await database.insert(deployments).values({
      id: nextBuild,
      appId,
      provider: "vercel",
      providerDeploymentId: "dpl_locked",
      status: "live",
      url: APP_ORIGIN,
      createdAt: new Date(Date.now() + 60_000),
    });

    const reachOf = async () =>
      (
        await database.select().from(capabilities).where(eq(capabilities.id, lockedId))
      )[0];

    try {
      // Looking at a page never re-asks what works, so nothing goes dark.
      await verifyAppCapabilities(appId);
      expect((await reachOf())?.reach).toBe("callable");

      // The deploy's own check does.
      await verifyAppCapabilities(appId, undefined, { afterDeploy: true });
      const row = await reachOf();
      expect(row?.reach).toBe("refused");
      expect(row?.answeredBy).toBe(nextBuild);

      const told = await database
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.kind, "capability-refused"),
            eq(notifications.subject, `${lockedId}:${nextBuild}`),
          ),
        );
      expect(told).toHaveLength(1);
    } finally {
      await database
        .delete(notifications)
        .where(eq(notifications.subject, `${lockedId}:${nextBuild}`));
      await database.delete(capabilities).where(eq(capabilities.id, lockedId));
      await database.delete(deployments).where(eq(deployments.id, nextBuild));
    }
  });

  /**
   * A write cannot be verified by calling it, and a framework answers the
   * method probe before it checks who is asking - so the real call is the
   * first thing that can know. What it learns has to be kept.
   */
  it("records a write the app turns away when it is really called", async () => {
    const { capabilities } = await import("@cira/db");
    const { eq } = await import("drizzle-orm");
    const runTool = await toolsAs();

    const lockId = newId("capability");
    const peekId = newId("capability");
    const shared = {
      appId,
      spaceId,
      inputSchema: { type: "object", properties: {}, required: [] },
      path: "/api/locked",
      enabled: true,
      reach: "callable" as const,
      answeredBy: deploymentId,
      verifiedAt: new Date(),
    };

    await database.insert(capabilities).values([
      {
        ...shared,
        id: lockId,
        name: "lockOrder",
        description: "Lock an order.",
        method: "POST",
        risk: "write",
      },
      {
        ...shared,
        id: peekId,
        name: "peekLock",
        description: "Look at a lock.",
        method: "GET",
        risk: "read",
      },
    ]);

    try {
      // Through Ask Cira, which asked its person in its own window: over MCP
      // the write would first wait for an approval, which is tested below.
      const wrote = await runTool(
        founder,
        "invoke_capability",
        { capabilityId: lockId, input: {} },
        "ask",
      );
      expect(wrote.isError).toBe(true);
      expect(wrote.content).toContain("will not let Cira call it");

      const [lock] = await database
        .select()
        .from(capabilities)
        .where(eq(capabilities.id, lockId));
      expect(lock?.reach).toBe("refused");
      expect(lock?.answeredBy).toBe(deploymentId);

      // A read that got through when it was verified keeps that answer. One
      // 401 on a real call is weaker evidence than the probe that succeeded,
      // and may be about what was asked for rather than who asked.
      const read = await runTool(founder, "invoke_capability", {
        capabilityId: peekId,
        input: {},
      });
      expect(read.isError).toBe(true);
      expect(read.content).toContain("failed (401)");

      const [peek] = await database
        .select()
        .from(capabilities)
        .where(eq(capabilities.id, peekId));
      expect(peek?.reach).toBe("callable");
    } finally {
      await database.delete(capabilities).where(eq(capabilities.id, lockId));
      await database.delete(capabilities).where(eq(capabilities.id, peekId));
    }
  });

  /**
   * The console is a second door onto the same room.
   *
   * It is reached by a person in a browser rather than an agent over MCP, and
   * it must not be a way round anything an agent is held to. So these run the
   * console's own action and compare it with what an agent is told: the two
   * agree on every refusal because they are the same call.
   */
  /**
   * A write asked for over MCP runs only once its person has approved it, on
   * a page in Cira. An assistant's client asking first is not enough: once
   * someone clicks "always allow" there, it never asks again.
   */
  describe("a write over MCP", () => {
    const payoutId = newId("capability");
    const pay = { vendor: "Globex", cents: 125_000 };

    beforeAll(async () => {
      const { capabilities } = await import("@cira/db");
      await database.insert(capabilities).values({
        id: payoutId,
        appId,
        spaceId,
        name: "payVendor",
        description: "Pay a vendor.",
        inputSchema: {
          type: "object",
          properties: { vendor: { type: "string" }, cents: { type: "integer" } },
          required: ["vendor", "cents"],
        },
        method: "POST",
        path: "/api/payouts",
        risk: "write",
        verifiedAt: new Date(),
        reach: "callable" as const,
        answeredBy: deploymentId,
        enabled: true,
      });
    });

    const payouts = () => received.filter((r) => r.url === "/api/payouts");

    /** Ask over MCP, and read back the approval Cira handed out. */
    async function ask(person: User, input: Record<string, unknown> = pay) {
      const runTool = await toolsAs();
      const first = await runTool(person, "invoke_capability", {
        capabilityId: payoutId,
        input,
      });
      expect(first.isError).toBe(false);
      return JSON.parse(first.content) as {
        status: string;
        approvalId: string;
        approvalUrl: string;
        expiresInMinutes: number;
      };
    }

    const again = async (
      person: User,
      approvalId: string,
      input: Record<string, unknown> = pay,
    ) => {
      const runTool = await toolsAs();
      return runTool(person, "invoke_capability", {
        capabilityId: payoutId,
        input,
        approvalId,
      });
    };

    it("does nothing at first, and hands back a link for its person", async () => {
      received.length = 0;
      const asked = await ask(employee);
      expect(asked).toMatchObject({ status: "needs_approval", expiresInMinutes: 15 });
      expect(asked.approvalUrl).toBe(`https://cira.test/approve/${asked.approvalId}`);
      expect(payouts()).toHaveLength(0);

      // Still waiting: calling again with the id is not approving it.
      const early = await again(employee, asked.approvalId);
      expect(early.isError).toBe(true);
      expect(early.content).toContain("not approved this yet");
      expect(payouts()).toHaveLength(0);
    });

    it("runs once its person approves, exactly once", async () => {
      const { decideApproval } = await import("./approval-actions");
      received.length = 0;
      const asked = await ask(employee);

      signedIn = employee;
      expect(await decideApproval(asked.approvalId, "approve")).toEqual({ ok: true });

      const ran = await again(employee, asked.approvalId);
      expect(ran.isError).toBe(false);
      expect(JSON.parse(ran.content)).toEqual({ paid: true });
      expect(payouts()).toHaveLength(1);

      // The record of who ran what says a person agreed to it.
      const { invocations } = await import("@cira/db");
      const { eq } = await import("drizzle-orm");
      const runs = await database
        .select()
        .from(invocations)
        .where(eq(invocations.approvalId, asked.approvalId));
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ userId: employee.id, via: "mcp", status: 201 });

      // The same approval, spent, does not pay twice.
      const twice = await again(employee, asked.approvalId);
      expect(twice.isError).toBe(true);
      expect(twice.content).toContain("already been used");
      expect(payouts()).toHaveLength(1);
    });

    it("covers exactly what was shown, not a different amount", async () => {
      const { decideApproval } = await import("./approval-actions");
      received.length = 0;
      const asked = await ask(employee);
      signedIn = employee;
      await decideApproval(asked.approvalId, "approve");

      const swapped = await again(employee, asked.approvalId, {
        ...pay,
        cents: 9_900_000,
      });
      expect(swapped.isError).toBe(true);
      expect(swapped.content).toContain("different input");
      expect(payouts()).toHaveLength(0);

      // The same input with its keys in another order is the same input.
      const same = await again(employee, asked.approvalId, {
        cents: pay.cents,
        vendor: pay.vendor,
      });
      expect(same.isError).toBe(false);
      expect(payouts()).toHaveLength(1);
    });

    it("is for its person only: nobody else can approve it, see it, or spend it", async () => {
      const { decideApproval } = await import("./approval-actions");
      const { loadApproval } = await import("./approvals");
      received.length = 0;
      const asked = await ask(employee);

      signedIn = founder;
      expect((await decideApproval(asked.approvalId, "approve")).ok).toBe(false);
      expect(await loadApproval(founder, asked.approvalId)).toBeNull();
      expect(await loadApproval(employee, asked.approvalId)).toMatchObject({
        status: "pending",
        input: pay,
        capability: { name: "payVendor", method: "POST", path: "/api/payouts" },
      });

      signedIn = employee;
      await decideApproval(asked.approvalId, "approve");
      const theirs = await again(founder, asked.approvalId);
      expect(theirs.isError).toBe(true);
      expect(payouts()).toHaveLength(0);
    });

    it("stays undone when its person declines", async () => {
      const { decideApproval } = await import("./approval-actions");
      received.length = 0;
      const asked = await ask(employee);
      signedIn = employee;
      expect(await decideApproval(asked.approvalId, "deny")).toEqual({ ok: true });
      // A second answer does not overturn the first.
      expect((await decideApproval(asked.approvalId, "approve")).ok).toBe(false);

      const ran = await again(employee, asked.approvalId);
      expect(ran.isError).toBe(true);
      expect(ran.content).toContain("declined");
      expect(payouts()).toHaveLength(0);
    });

    it("lapses after fifteen minutes, approved or not", async () => {
      const { approvals } = await import("@cira/db");
      const { eq } = await import("drizzle-orm");
      const { decide, loadApproval } = await import("./approvals");
      received.length = 0;

      const late = await ask(employee);
      const inTime = await ask(employee);
      await decide(employee, inTime.approvalId, "approve");
      const past = new Date(Date.now() - 60_000);
      await database
        .update(approvals)
        .set({ expiresAt: past })
        .where(eq(approvals.id, late.approvalId));
      await database
        .update(approvals)
        .set({ expiresAt: past })
        .where(eq(approvals.id, inTime.approvalId));

      expect(await decide(employee, late.approvalId, "approve")).toBe(false);
      expect(await loadApproval(employee, late.approvalId)).toMatchObject({
        status: "expired",
      });
      const ran = await again(employee, inTime.approvalId);
      expect(ran.isError).toBe(true);
      expect(ran.content).toContain("lapsed");
      expect(payouts()).toHaveLength(0);
    });

    it("leaves reads, and Ask Cira, which asks in its own window, as they were", async () => {
      const runTool = await toolsAs();
      received.length = 0;
      const read = await runTool(employee, "invoke_capability", {
        capabilityId: revenueId,
        input: { startDate: "2026-01-01", endDate: "2026-02-01" },
      });
      expect(read.isError).toBe(false);
      expect(read.content).not.toContain("needs_approval");

      const viaAsk = await runTool(
        employee,
        "invoke_capability",
        { capabilityId: payoutId, input: pay },
        "ask",
      );
      expect(viaAsk.isError).toBe(false);
      expect(payouts()).toHaveLength(1);
    });
  });

  /** What a real call puts on the wire, and what it makes of the answer. */
  describe("a call, on the wire", () => {
    const ids = {
      echoWrite: newId("capability"),
      echoRead: newId("capability"),
      redirectWrite: newId("capability"),
      htmlWrite: newId("capability"),
    };

    beforeAll(async () => {
      const { capabilities } = await import("@cira/db");
      const common = {
        appId,
        spaceId,
        verifiedAt: new Date(),
        reach: "callable" as const,
        answeredBy: deploymentId,
        enabled: true,
      };
      await database.insert(capabilities).values([
        {
          ...common,
          id: ids.echoWrite,
          name: "saveNote",
          description: "Save a note.",
          inputSchema: {
            type: "object",
            properties: { note: { type: "string" } },
            required: ["note"],
          },
          method: "POST",
          path: "/api/echo",
          risk: "write",
        },
        {
          ...common,
          id: ids.echoRead,
          name: "findByTags",
          description: "Find by tags.",
          inputSchema: {
            type: "object",
            properties: { tag: { type: "array", items: { type: "string" } } },
            required: [],
          },
          method: "GET",
          path: "/api/echo",
          risk: "read",
        },
        {
          ...common,
          id: ids.redirectWrite,
          name: "placeOrder",
          description: "Place an order.",
          inputSchema: { type: "object", properties: {}, required: [] },
          method: "POST",
          path: "/api/after-write",
          risk: "write",
        },
        {
          ...common,
          id: ids.htmlWrite,
          name: "saveForm",
          description: "Save a form.",
          inputSchema: { type: "object", properties: {}, required: [] },
          method: "POST",
          path: "/api/html-write",
          risk: "write",
        },
      ]);
    });

    // Ask Cira, which asked its person already, so the call goes straight out.
    const run = async (capabilityId: string, input: Record<string, unknown>) => {
      const runTool = await toolsAs();
      return runTool(employee, "invoke_capability", { capabilityId, input }, "ask");
    };

    it("sends a body with accents and other scripts at its length in bytes", async () => {
      const note = "Café Zoë paid 1 250 € - 東京支店";
      const sent = await run(ids.echoWrite, { note });
      expect(sent.isError).toBe(false);
      const echoed = JSON.parse(sent.content) as {
        body: unknown;
        declared: string;
        received: number;
      };
      expect(echoed.body).toEqual({ note });
      expect(Number(echoed.declared)).toBe(echoed.received);
    });

    it("sends what a write reads from the query there, and the rest as its body", async () => {
      const { capabilities } = await import("@cira/db");
      const { eq } = await import("drizzle-orm");
      const id = newId("capability");
      await database.insert(capabilities).values({
        id,
        appId,
        spaceId,
        name: "tagNote",
        description: "Tag a note.",
        inputSchema: {
          type: "object",
          properties: {
            note: { type: "string" },
            tag: { type: "string", "x-cira-in": "query" },
          },
          required: ["note"],
        },
        method: "POST",
        path: "/api/echo",
        risk: "write",
        verifiedAt: new Date(),
        reach: "callable" as const,
        answeredBy: deploymentId,
        enabled: true,
      });
      try {
        const sent = await run(id, { note: "hello", tag: "urgent" });
        expect(JSON.parse(sent.content)).toMatchObject({
          body: { note: "hello" },
          tags: ["urgent"],
        });
      } finally {
        await database.delete(capabilities).where(eq(capabilities.id, id));
      }
    });

    it("sends a list in a query as the key once per item", async () => {
      const found = await run(ids.echoRead, { tag: ["urgent", "vip"] });
      expect(found.isError).toBe(false);
      expect(JSON.parse(found.content)).toMatchObject({ tags: ["urgent", "vip"] });
    });

    it("never tells anyone a write that redirected did not happen", async () => {
      const placed = await run(ids.redirectWrite, {});
      expect(placed.isError).toBe(true);
      expect(placed.content).toContain("may still have been made");
      expect(placed.content).not.toContain("not reachable");
    });

    it("reports a write the app accepted with HTML as done", async () => {
      const saved = await run(ids.htmlWrite, {});
      expect(saved.isError).toBe(false);
      expect(JSON.parse(saved.content)).toMatchObject({ accepted: true });
    });

    // Confirmed once used to mean confirmed for good, through every deploy.
    it("sends a capability whose route is gone back to be checked again", async () => {
      const { capabilities } = await import("@cira/db");
      const { eq } = await import("drizzle-orm");
      const goneId = newId("capability");
      const recordId = newId("capability");
      const lookupId = newId("capability");
      const common = {
        appId,
        spaceId,
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" } },
          required: [],
        },
        method: "GET" as const,
        risk: "read" as const,
        verifiedAt: new Date(),
        reach: "callable" as const,
        answeredBy: deploymentId,
        enabled: true,
      };
      await database.insert(capabilities).values([
        {
          ...common,
          id: goneId,
          name: "oldReport",
          description: "Old.",
          path: "/api/removed",
        },
        // A 404 in the app's own words is the record, not the route.
        {
          ...common,
          id: lookupId,
          name: "lookupOrder",
          description: "Look up an order.",
          path: "/api/lookup",
        },
        // An id in the path: a 404 there is the record, not the route.
        {
          ...common,
          id: recordId,
          name: "getThing",
          description: "A thing.",
          path: "/api/things/{id}",
        },
      ]);
      try {
        expect((await run(goneId, {})).content).toContain("failed (404)");
        expect((await run(recordId, { id: "nope" })).content).toContain("failed (404)");
        expect((await run(lookupId, { id: "nope" })).content).toContain("failed (404)");
        const reach = async (id: string) =>
          (await database.select().from(capabilities).where(eq(capabilities.id, id)))[0]
            ?.reach;
        expect(await reach(goneId)).toBe("pending");
        expect(await reach(recordId)).toBe("callable");
        expect(await reach(lookupId)).toBe("callable");
      } finally {
        await database.delete(capabilities).where(eq(capabilities.id, goneId));
        await database.delete(capabilities).where(eq(capabilities.id, recordId));
        await database.delete(capabilities).where(eq(capabilities.id, lookupId));
      }
    });

    it("keeps calling the build that is serving while a new one builds, or after one failed", async () => {
      const { deployments } = await import("@cira/db");
      const { eq } = await import("drizzle-orm");
      const building = newId("deployment");
      const failed = newId("deployment");
      await database.insert(deployments).values([
        {
          id: failed,
          appId,
          provider: "cloudrun",
          providerDeploymentId: "b_failed",
          status: "failed",
          createdAt: new Date(Date.now() + 1_000),
        },
        {
          id: building,
          appId,
          provider: "cloudrun",
          providerDeploymentId: "b_building",
          status: "building",
          createdAt: new Date(Date.now() + 2_000),
        },
      ]);
      try {
        const found = await run(ids.echoRead, { tag: ["a"] });
        expect(found.isError).toBe(false);
      } finally {
        await database.delete(deployments).where(eq(deployments.id, building));
        await database.delete(deployments).where(eq(deployments.id, failed));
      }
    });

    it("gives up on an answer that trickles, within the deadline, and says a write may have landed", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const real = globalThis.fetch;
      // Headers at once, then a body that never finishes - until the deadline
      // aborts it, as a real connection would be.
      vi.stubGlobal("fetch", (_url: unknown, init?: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(stream) {
            stream.enqueue(new TextEncoder().encode('{"par'));
            init?.signal?.addEventListener("abort", () =>
              stream.error(new DOMException("aborted", "AbortError")),
            );
          },
        });
        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      });
      try {
        const pending = run(ids.echoWrite, { note: "x" });
        await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThan(0));
        await vi.advanceTimersByTimeAsync(15_000);
        const result = await pending;
        expect(result.isError).toBe(true);
        expect(result.content).toContain("took longer than 15 seconds");
        expect(result.content).toContain("may still have been made");
      } finally {
        vi.stubGlobal("fetch", real);
        vi.useRealTimers();
      }
    });
  });

  describe("through the console", () => {
    const input = { startDate: "2026-08-01", endDate: "2026-08-31" };
    // Their own rows, because the cases above rewrite the app's capability
    // set as they go and these should not depend on where that left it.
    const readId = newId("capability");
    const writeId = newId("capability");

    beforeAll(async () => {
      const { capabilities } = await import("@cira/db");
      const confirmed = {
        appId,
        spaceId,
        reach: "callable" as const,
        answeredBy: deploymentId,
        verifiedAt: new Date(),
      };
      await database.insert(capabilities).values([
        {
          ...confirmed,
          id: readId,
          name: "consoleRevenue",
          description: "Total revenue between two dates.",
          inputSchema: {
            type: "object",
            properties: { startDate: { type: "string" }, endDate: { type: "string" } },
            required: ["startDate", "endDate"],
          },
          method: "GET",
          path: "/api/revenue",
          risk: "read",
          enabled: true,
        },
        {
          ...confirmed,
          id: writeId,
          name: "consoleRefund",
          description: "Refund a payment.",
          inputSchema: { type: "object", properties: {}, required: [] },
          method: "POST",
          path: "/api/refunds",
          risk: "write",
          // As every write starts: confirmed by the app, and off.
          enabled: false,
        },
      ]);
    });

    afterAll(async () => {
      const { capabilities } = await import("@cira/db");
      const { inArray } = await import("drizzle-orm");
      signedIn = null;
      await database
        .delete(capabilities)
        .where(inArray(capabilities.id, [readId, writeId]));
    });

    it("runs a read for everyone who may open the app", async () => {
      const { runCapability } = await import("./console-actions");

      // Access alone, ownership, and administering the space: each is enough.
      for (const person of [employee, founder, admin]) {
        signedIn = person;
        received.length = 0;

        const run = await runCapability(readId, input);

        expect(run.ok).toBe(true);
        expect(run.error).toBeNull();
        expect(run.answer?.status).toBe(200);
        expect(JSON.parse(run.answer?.body ?? "null")).toMatchObject({
          total: 482913.55,
        });
        expect(run.answer?.elapsedMs).toBeGreaterThanOrEqual(0);

        // It arrived as Cira and as nobody else: the app's token, and not one
        // header that says which person pressed the button.
        const hit = received[0];
        expect(hit?.headers["x-serverless-authorization"]).toBe(
          `Bearer ${tokenFor(APP_ORIGIN)}`,
        );
        expect(hit?.headers["authorization"]).toBeUndefined();
        expect(hit?.headers["cookie"]).toBeUndefined();
        expect(JSON.stringify(hit?.headers)).not.toContain(person.email);
        expect(JSON.stringify(hit?.headers)).not.toContain(person.id);
      }
    });

    it("gives a member without access nothing, in the words an agent gets", async () => {
      const { runCapability } = await import("./console-actions");
      const runTool = await toolsAs();

      for (const person of [bystander, outsider]) {
        signedIn = person;
        received.length = 0;

        const run = await runCapability(readId, input);
        const agent = await runTool(person, "invoke_capability", {
          capabilityId: readId,
          input,
        });

        expect(run).toEqual({ ok: false, error: NO_SUCH_CAPABILITY, answer: null });
        expect(run.error).toBe(agent.content);
        expect(received).toHaveLength(0);
      }
    });

    it("cannot run a disabled write for anyone, whoever manages the app", async () => {
      const { runCapability } = await import("./console-actions");
      const runTool = await toolsAs();

      for (const person of [founder, admin, employee]) {
        signedIn = person;
        received.length = 0;

        const run = await runCapability(writeId, {});
        const agent = await runTool(person, "invoke_capability", {
          capabilityId: writeId,
          input: {},
        });

        expect(run.ok).toBe(false);
        expect(run.error).toContain("not enabled");
        expect(run.error).toBe(agent.content);
        expect(run.answer).toBeNull();
        expect(received).toHaveLength(0);
      }
    });

    it("takes nobody's word for who is asking, or for what", async () => {
      const { runCapability } = await import("./console-actions");

      // Signed out: nothing, whatever the id.
      signedIn = null;
      received.length = 0;
      expect(await runCapability(readId, input)).toEqual({
        ok: false,
        error: "Sign in to run capabilities.",
        answer: null,
      });

      // An id that is not an id, and input the schema does not allow, are
      // turned away before the app is reached.
      signedIn = employee;
      expect((await runCapability({ id: readId }, input)).error).toBe(NO_SUCH_CAPABILITY);
      const bad = await runCapability(readId, { startDate: 20260801 });
      expect(bad.ok).toBe(false);
      expect(bad.error).toMatch(/^Invalid input/);
      expect(received).toHaveLength(0);
    });
  });
  /**
   * The record of who ran what, and the per-person limit counted from it.
   *
   * Every surface goes through the same function, so each writes the same
   * row: who, which capability, from where, how it ended - and never what was
   * sent or what came back.
   */
  describe("the record of who ran what", () => {
    const readId = newId("capability");
    const writeId = newId("capability");

    beforeAll(async () => {
      const { capabilities } = await import("@cira/db");
      const confirmed = {
        appId,
        spaceId,
        reach: "callable" as const,
        answeredBy: deploymentId,
        verifiedAt: new Date(),
      };
      await database.insert(capabilities).values([
        {
          ...confirmed,
          id: readId,
          name: "recordedRevenue",
          description: "Total revenue between two dates.",
          inputSchema: {
            type: "object",
            properties: { startDate: { type: "string" }, endDate: { type: "string" } },
            required: ["startDate", "endDate"],
          },
          method: "GET",
          path: "/api/revenue",
          risk: "read",
          enabled: true,
        },
        {
          ...confirmed,
          id: writeId,
          name: "recordedRefund",
          description: "Refund a payment.",
          inputSchema: { type: "object", properties: {}, required: [] },
          method: "POST",
          path: "/api/refunds",
          risk: "write",
          enabled: false,
        },
      ]);
    });

    const runsOf = async (capabilityId: string) => {
      const { invocations } = await import("@cira/db");
      const { eq } = await import("drizzle-orm");
      return database
        .select()
        .from(invocations)
        .where(eq(invocations.capabilityId, capabilityId));
    };

    it("records each run with who, where from and how it ended, never the input", async () => {
      const runTool = await toolsAs();
      const { runCapability } = await import("./console-actions");
      const secretish = "2026-08-01";

      await runTool(employee, "invoke_capability", {
        capabilityId: readId,
        input: { startDate: secretish, endDate: "2026-08-31" },
      });
      signedIn = founder;
      await runCapability(readId, { startDate: secretish, endDate: "2026-08-31" });
      await runTool(
        employee,
        "invoke_capability",
        { capabilityId: writeId, input: {} },
        "ask",
      );

      const reads = await runsOf(readId);
      expect(
        reads.map((r) => ({
          user: r.userId,
          via: r.via,
          outcome: r.outcome,
          status: r.status,
        })),
      ).toEqual(
        expect.arrayContaining([
          { user: employee.id, via: "mcp", outcome: "ran", status: 200 },
          { user: founder.id, via: "console", outcome: "ran", status: 200 },
        ]),
      );
      expect(reads[0]?.capabilityName).toBe("recordedRevenue");
      expect(reads[0]?.appId).toBe(appId);

      // Stopped by a check: recorded, with no status, because nothing was sent.
      const writes = await runsOf(writeId);
      expect(writes).toHaveLength(1);
      expect(writes[0]).toMatchObject({ via: "ask", outcome: "disabled", status: null });

      // Not a byte of what was sent is in the record.
      const dump = await database.execute(sql`select t::text as row from invocations t`);
      expect(JSON.stringify(dump.rows)).not.toContain(secretish);
    });

    it("writes nothing about a capability the person cannot see", async () => {
      const runTool = await toolsAs();
      const before = (await runsOf(readId)).length;
      await runTool(outsider, "invoke_capability", {
        capabilityId: readId,
        input: { startDate: "2026-08-01", endDate: "2026-08-31" },
      });
      expect(await runsOf(readId)).toHaveLength(before);
    });

    it("stops a person at the minute's limit, without calling the app or recording it", async () => {
      const { invocations } = await import("@cira/db");
      const runTool = await toolsAs();
      const { invocationsPerPersonPerMinute } = DEFAULT_LIMITS;

      // A minute's worth already, the way a runaway script would have made it.
      await database.insert(invocations).values(
        Array.from({ length: invocationsPerPersonPerMinute }, () => ({
          id: newId("invocation"),
          spaceId,
          appId,
          capabilityId: readId,
          capabilityName: "recordedRevenue",
          userId: admin.id,
          via: "mcp" as const,
          outcome: "ran" as const,
          status: 200,
        })),
      );
      received.length = 0;
      const before = (await runsOf(readId)).length;

      const limited = await runTool(admin, "invoke_capability", {
        capabilityId: readId,
        input: { startDate: "2026-08-01", endDate: "2026-08-31" },
      });

      expect(limited.isError).toBe(true);
      expect(limited.content).toContain(
        `${invocationsPerPersonPerMinute} capabilities in the last minute`,
      );
      expect(received).toHaveLength(0);
      expect(await runsOf(readId)).toHaveLength(before);

      // Someone else is not held up by it.
      const other = await runTool(employee, "invoke_capability", {
        capabilityId: readId,
        input: { startDate: "2026-08-01", endDate: "2026-08-31" },
      });
      expect(other.isError).toBe(false);
    });

    /**
     * A burst in parallel, the way a script or an agent fanning out sends
     * one. Counting before the call and writing after let every one of them
     * see the same count and pass.
     */
    it("holds the limit against calls made all at once", async () => {
      const { invocations } = await import("@cira/db");
      const runTool = await toolsAs();
      const { invocationsPerPersonPerMinute } = DEFAULT_LIMITS;
      const room = 3;

      await database.insert(invocations).values(
        Array.from({ length: invocationsPerPersonPerMinute - room }, () => ({
          id: newId("invocation"),
          spaceId,
          appId,
          capabilityId: readId,
          capabilityName: "recordedRevenue",
          userId: founder.id,
          via: "mcp" as const,
          outcome: "ran" as const,
          status: 200,
        })),
      );

      const burst = await Promise.all(
        Array.from({ length: 10 }, () =>
          runTool(founder, "invoke_capability", {
            capabilityId: readId,
            input: { startDate: "2026-08-01", endDate: "2026-08-31" },
          }),
        ),
      );
      const through = burst.filter((r) => !r.isError).length;
      expect(through).toBeLessThanOrEqual(room);
      expect(burst.filter((r) => r.content.includes("in the last minute")).length).toBe(
        10 - through,
      );
    });
  });
});
