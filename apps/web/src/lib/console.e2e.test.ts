import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { consoleAffordance, formFor, newId, type User } from "@cira/core";
import type * as CiraDb from "@cira/db";
import type * as CiraDeploy from "@cira/deploy";
import { migratedTestDatabase } from "../../../../packages/db/src/test-database.js";
import type { AnalyzedCapability } from "./capability-grounding";

/**
 * The capability console against a real API-only app.
 *
 * `fixtures/backend-only-service` is started as a process, the way it runs
 * once deployed, and Cira is taken through everything that happens to it:
 * capabilities are registered as the analyzer would propose them, the running
 * app is asked about each, and then a person who may only open the app runs
 * them from the console. What each capability should end up as is not written
 * here. It is read from the table in the fixture's README, so the service, its
 * documentation and this test cannot quietly disagree.
 *
 * Swapped, as in the engine test: the database driver, the minting of the
 * app's identity token, and who is signed in. Everything else is real.
 *
 * Skips itself without a database, without Python, or without the fixture.
 */

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];
const FIXTURE = join(process.cwd(), "fixtures", "backend-only-service");
const PORT = 4633;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const hasDatabase = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== "";
const hasPython = spawnSync("python3", ["--version"]).status === 0;
const hasFixture = existsSync(join(FIXTURE, "app.py"));

let database: Awaited<ReturnType<typeof migratedTestDatabase>>;

vi.mock("@cira/db", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDb>();
  return { ...actual, db: () => database };
});

vi.mock("@cira/deploy", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDeploy>();
  return {
    ...actual,
    deploymentProvider: () => ({
      invocationToken: (audience: string) => Promise.resolve(`id-token-for-${audience}`),
    }),
  };
});

let signedIn: User | null = null;
vi.mock("@/lib/identity", () => ({
  getCurrentUser: () => Promise.resolve(signedIn),
  requireCurrentUser: () => Promise.resolve(signedIn),
}));

/** One row of the README's expected-capabilities table. */
interface Expected {
  method: string;
  path: string;
  risk: "read" | "write";
  reach: "callable" | "refused" | "pending";
  enabled: boolean;
}

/**
 * The table under "## Expected capabilities", and nothing else in the file.
 * Paths are written in backticks there, for reading; they come out bare.
 */
function expectedCapabilities(): Expected[] {
  const readme = readFileSync(join(FIXTURE, "README.md"), "utf8");
  const start = readme.indexOf("## Expected capabilities");
  const end = readme.indexOf("\n#", start + 1);
  const section = readme.slice(start, end === -1 ? undefined : end);

  return section
    .split("\n")
    .map((line) => line.split("|").map((cell) => cell.trim()))
    .filter((cells) => /^(GET|POST|PUT|PATCH|DELETE)$/.test(cells[1] ?? ""))
    .map((cells) => ({
      method: cells[1] ?? "",
      path: (cells[2] ?? "").replaceAll("`", ""),
      risk: cells[3] === "write" ? "write" : "read",
      reach: (cells[4] ?? "pending") as Expected["reach"],
      enabled: cells[5] === "yes",
    }));
}

/**
 * What an analyzer reading `app.py` should propose - the names, schemas and
 * example inputs are this test's to choose, the outcomes are the README's.
 * Keyed by route, so a route in the table with nothing here fails loudly.
 */
const PROPOSED: Record<string, Omit<AnalyzedCapability, "method" | "path" | "risk">> = {
  "GET /orders": {
    name: "listOrders",
    description: "Orders, newest first, optionally only those with one status.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["paid", "pending", "refunded"] },
        limit: { type: "integer", description: "At most this many, 1 to 100." },
      },
    },
    outputSchema: null,
    probe: { limit: 5 },
  },
  "GET /orders/lookup": {
    name: "lookupOrder",
    description: "One order by its id.",
    inputSchema: {
      type: "object",
      properties: { order_id: { type: "string" } },
      required: ["order_id"],
    },
    outputSchema: null,
    probe: { order_id: "ord_1001" },
  },
  "GET /revenue": {
    name: "getRevenue",
    description: "Revenue from orders placed between two dates, refunds excluded.",
    inputSchema: {
      type: "object",
      properties: {
        start: { type: "string", format: "date" },
        end: { type: "string", format: "date" },
      },
      required: ["start", "end"],
    },
    outputSchema: null,
    probe: { start: "2026-08-01", end: "2026-08-31" },
  },
  "GET /customers/top": {
    name: "topCustomers",
    description: "Customers ranked by what they have spent.",
    inputSchema: { type: "object", properties: { limit: { type: "integer" } } },
    outputSchema: null,
    probe: {},
  },
  "GET /admin/audit": {
    name: "getAuditLog",
    description: "The admin audit log.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: null,
    probe: {},
  },
  "POST /orders/refund": {
    name: "refundOrder",
    description: "Refund an order.",
    inputSchema: {
      type: "object",
      properties: { order_id: { type: "string" }, reason: { type: "string" } },
      required: ["order_id"],
    },
    outputSchema: null,
  },
  "POST /reports/regenerate": {
    name: "regenerateReport",
    description: "Rebuild one of the named reports.",
    inputSchema: {
      type: "object",
      properties: {
        report: { type: "string", enum: ["daily-sales", "refunds", "top-customers"] },
      },
      required: ["report"],
    },
    outputSchema: null,
  },
};

const owner: User = {
  id: newId("user"),
  name: "Priya",
  email: "priya@orders.test",
  createdAt: new Date(),
};
/** Given access to this one app and nothing else. */
const clerk: User = {
  id: newId("user"),
  name: "Sam",
  email: "sam@orders.test",
  createdAt: new Date(),
};

const spaceId = newId("space");
const appId = newId("app");
const deploymentId = newId("deployment");

let service: ChildProcess | undefined;
const expected = hasFixture ? expectedCapabilities() : [];
const ids = new Map<string, string>();

describe.skipIf(!hasDatabase || !hasPython || !hasFixture)(
  "the console, against the backend-only fixture",
  () => {
    beforeAll(async () => {
      service = spawn("python3", [join(FIXTURE, "app.py")], {
        env: { ...process.env, PORT: String(PORT) },
        stdio: "ignore",
      });
      await until(async () => (await fetch(`${ORIGIN}/health`)).ok);

      database = await migratedTestDatabase(TEST_DATABASE_URL as string, "cira_console");
      const { appAccess, apps, deployments, memberships, spaces, users } =
        await import("@cira/db");

      await database.insert(users).values([
        { id: owner.id, externalId: "c1", name: owner.name, email: owner.email },
        { id: clerk.id, externalId: "c2", name: clerk.name, email: clerk.email },
      ]);
      await database
        .insert(spaces)
        .values({ id: spaceId, name: "Orders", slug: "orders", domain: "orders.test" });
      await database.insert(memberships).values([
        { id: newId("membership"), userId: owner.id, spaceId, role: "member" },
        { id: newId("membership"), userId: clerk.id, spaceId, role: "member" },
      ]);
      await database.insert(apps).values({
        id: appId,
        spaceId,
        name: "Orders",
        slug: "orders-service",
        status: "live",
        ownerUserId: owner.id,
      });
      await database
        .insert(appAccess)
        .values({ id: newId("access"), appId, type: "user", targetId: clerk.id });
      await database.insert(deployments).values({
        id: deploymentId,
        appId,
        provider: "cloudrun",
        providerDeploymentId: "orders-00001",
        status: "live",
        url: ORIGIN,
      });

      // Registered the way a deploy registers them, so which ones switch
      // themselves on is the real publication policy's decision.
      const { replaceCapabilities } = await import("./capabilities");
      await replaceCapabilities({
        appId,
        spaceId,
        detected: expected.map((row) => {
          const proposal = PROPOSED[`${row.method} ${row.path}`];
          if (proposal === undefined) {
            throw new Error(
              `The README lists ${row.method} ${row.path}; add it to PROPOSED.`,
            );
          }
          return {
            ...proposal,
            method: row.method as AnalyzedCapability["method"],
            path: row.path,
            risk: row.risk,
          };
        }),
      });

      await fetch(`${ORIGIN}/__reset`, { method: "POST" });
    }, 60_000);

    afterAll(async () => {
      service?.kill();
      signedIn = null;
      await database?.end();
    });

    it("finds no front door, and confirms each capability as the README says", async () => {
      const { verifyAppCapabilities } = await import("./capability-verification");
      const { apps, capabilities } = await import("@cira/db");
      const { eq } = await import("drizzle-orm");

      const outcome = await verifyAppCapabilities(appId);
      expect(outcome).toMatchObject({ ok: true, inconclusive: false, absent: 0 });

      // Asked while verifying: the root answers JSON, so this is not a website
      // - and so the Open button leads to the console.
      const [row] = await database.select().from(apps).where(eq(apps.id, appId));
      expect(row?.hasWebUi).toBe(false);

      const { resolveAppState, appDoor } = await import("./app-state");
      const { latestDeployment } = await import("./queries");
      const resolved = resolveAppState(
        row!,
        await latestDeployment(appId),
        "/enter/orders-service--orders",
      );
      expect(resolved.state).toBe("no-ui");
      expect(
        appDoor(
          resolved,
          { spaceSlug: "orders", appSlug: "orders-service" },
          expected.length,
        ).href,
      ).toBe("/orders/orders-service/console");

      const stored = await database
        .select()
        .from(capabilities)
        .where(eq(capabilities.appId, appId));
      expect(stored).toHaveLength(expected.length);

      for (const want of expected) {
        const got = stored.find((c) => c.method === want.method && c.path === want.path);
        expect(got, `${want.method} ${want.path}`).toBeDefined();
        expect({ route: `${want.method} ${want.path}`, reach: got?.reach }).toEqual({
          route: `${want.method} ${want.path}`,
          reach: want.reach,
        });
        expect({ route: `${want.method} ${want.path}`, enabled: got?.enabled }).toEqual({
          route: `${want.method} ${want.path}`,
          enabled: want.enabled,
        });
        ids.set(`${want.method} ${want.path}`, got?.id ?? "");
      }
    });

    it("draws every capability as a form, and offers only what may run", async () => {
      const { listConsoleCapabilities } = await import("./capabilities");
      const listed = await listConsoleCapabilities(appId);

      for (const want of expected) {
        const capability = listed.find(
          (c) => c.target.method === want.method && c.target.path === want.path,
        );
        const affordance = consoleAffordance(capability!);
        const kind =
          want.reach === "refused"
            ? "refused"
            : want.reach === "pending"
              ? "pending"
              : want.enabled
                ? "run"
                : "off";
        expect({ route: `${want.method} ${want.path}`, kind: affordance.kind }).toEqual({
          route: `${want.method} ${want.path}`,
          kind,
        });

        // Every schema here is flat, so none falls back to raw JSON; a read's
        // form starts from the input the app was verified with.
        const form = formFor(capability!.inputSchema, capability!.example);
        expect(form.kind).toBe("fields");
        if (want.risk === "write") expect(capability!.example).toBeNull();
      }

      const lookup = listed.find((c) => c.name === "lookupOrder")!;
      const form = formFor(lookup.inputSchema, lookup.example);
      expect(form.kind === "fields" && form.fields[0]).toMatchObject({
        name: "order_id",
        kind: "text",
        required: true,
        initial: "ord_1001",
      });
    });

    it("runs every confirmed read for someone whose only right is access", async () => {
      const { runCapability } = await import("./console-actions");
      const { listConsoleCapabilities } = await import("./capabilities");
      signedIn = clerk;

      const listed = await listConsoleCapabilities(appId);
      const reads = expected.filter((e) => e.risk === "read" && e.reach === "callable");
      expect(reads.length).toBeGreaterThan(0);

      for (const want of reads) {
        const capability = listed.find((c) => c.target.path === want.path)!;
        const run = await runCapability(capability.id, capability.example ?? {});
        expect({ route: want.path, status: run.answer?.status }).toEqual({
          route: want.path,
          status: 200,
        });
        expect(run.ok).toBe(true);
      }

      // The refused one is turned away by Cira, in words, without the app
      // being asked again.
      const audit = await runCapability(ids.get("GET /admin/audit"), {});
      expect(audit.ok).toBe(false);
      expect(audit.answer).toBeNull();
      expect(audit.error).toContain("will not let Cira call it");

      // An app's own error comes through as the app said it.
      const lookup = listed.find((c) => c.name === "lookupOrder")!;
      const missing = await runCapability(lookup.id, { order_id: "ord_9999" });
      expect(missing.ok).toBe(false);
      expect(missing.answer?.status).toBe(404);
      expect(JSON.parse(missing.answer?.body ?? "{}")).toEqual({
        error: "No order ord_9999",
      });
    });

    it("keeps a refund shut until whoever manages the app turns it on", async () => {
      const { runCapability } = await import("./console-actions");
      const { updateCapabilityEnabled } = await import("./capabilities");
      const refund = ids.get("POST /orders/refund")!;
      const lookup = ids.get("GET /orders/lookup")!;
      const input = { order_id: "ord_1002", reason: "Charged twice" };

      signedIn = clerk;
      const shut = await runCapability(refund, input);
      expect(shut.ok).toBe(false);
      expect(shut.error).toContain("not enabled");

      // Access to the app is not the right to decide what it lets agents do.
      expect((await updateCapabilityEnabled(clerk, refund, true)).ok).toBe(false);
      expect((await runCapability(refund, input)).error).toContain("not enabled");

      // The owner can, and then the refund runs - for the clerk too.
      expect(await updateCapabilityEnabled(owner, refund, true)).toEqual({ ok: true });
      const done = await runCapability(refund, input);
      expect(done.ok).toBe(true);
      expect(JSON.parse(done.answer?.body ?? "{}")).toMatchObject({
        refund: { order_id: "ord_1002", amount: 480.5, reason: "Charged twice" },
      });

      // The write happened in the app, visibly.
      const after = await runCapability(lookup, { order_id: "ord_1002" });
      expect(JSON.parse(after.answer?.body ?? "{}")).toMatchObject({
        order: { order_id: "ord_1002", status: "refunded" },
      });

      // And the app's refusal of a second one is passed on untouched.
      const again = await runCapability(refund, input);
      expect(again.ok).toBe(false);
      expect(again.answer?.status).toBe(409);
      expect(JSON.parse(again.answer?.body ?? "{}")).toEqual({
        error: "ord_1002 has already been refunded",
      });
    });
  },
);

async function until(ready: () => Promise<boolean>, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      if (await ready()) return;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error("The fixture service did not start.");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
