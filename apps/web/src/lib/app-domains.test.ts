import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { newId } from "@cira/core";
import type * as CiraDb from "@cira/db";
import { migratedTestDatabase } from "../../../../packages/db/src/test-database.js";

/**
 * A company's own names for its apps, against a real database and a fake
 * Cloudflare behind `fetch`.
 */

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];
const hasDatabase = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== "";

let database: Awaited<ReturnType<typeof migratedTestDatabase>>;
vi.mock("@cira/db", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDb>();
  return { ...actual, db: () => database };
});

/** What Cloudflare says about each hostname it was asked for, by id. */
const cloudflare = new Map<string, { hostname: string; status: string; ssl: string }>();
const calls: string[] = [];

const userId = newId("user");
const spaceId = newId("space");
const appId = newId("app");
const otherAppId = newId("app");

describe.skipIf(!hasDatabase)("an app's own domains", () => {
  beforeAll(async () => {
    database = await migratedTestDatabase(TEST_DATABASE_URL as string, "cira_domains");
    const { users, spaces, apps } = await import("@cira/db");
    await database
      .insert(users)
      .values({ id: userId, externalId: "x_dom", name: "Dana", email: "dana@acme.test" });
    await database.insert(spaces).values({ id: spaceId, name: "Acme", slug: "acme" });
    await database.insert(apps).values([
      {
        id: appId,
        spaceId,
        name: "Ledger",
        slug: "ledger",
        ownerUserId: userId,
        status: "live",
      },
      {
        id: otherAppId,
        spaceId,
        name: "Payroll",
        slug: "payroll",
        ownerUserId: userId,
        status: "live",
      },
    ]);

    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
      const path = String(input).replace(
        /^https:\/\/api\.cloudflare\.com\/client\/v4\/zones\/zone1/,
        "",
      );
      const method = init?.method ?? "GET";
      calls.push(`${method} ${path}`);
      const ok = (result: unknown) => Response.json({ success: true, result });
      if (path.startsWith("/dns_records?")) return ok([{ id: "r", proxied: true }]);
      if (path === "/custom_hostnames/fallback_origin")
        return ok({ origin: "domains.cira.dev" });
      if (path === "/workers/routes")
        return ok([{ pattern: "*/*", script: "cira-app-proxy" }]);
      if (method === "POST" && path === "/custom_hostnames") {
        const { hostname } = JSON.parse(String(init?.body)) as { hostname: string };
        const id = `ch_${cloudflare.size + 1}`;
        cloudflare.set(id, { hostname, status: "pending", ssl: "pending_validation" });
        return ok({
          id,
          hostname,
          status: "pending",
          ssl: { status: "pending_validation" },
        });
      }
      const id = path.split("/").at(-1)!;
      const held = cloudflare.get(id);
      if (held === undefined) {
        return Response.json(
          { success: false, errors: [{ code: 1436, message: "not found" }] },
          { status: 404 },
        );
      }
      if (method === "DELETE") {
        cloudflare.delete(id);
        return ok({ id });
      }
      return ok({
        id,
        hostname: held.hostname,
        status: held.status,
        ssl: { status: held.ssl },
      });
    });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await database?.end();
  });

  beforeEach(() => {
    calls.length = 0;
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "cf_test");
    vi.stubEnv("CLOUDFLARE_ZONE_ID", "zone1");
    vi.stubEnv("CIRA_DOMAINS_TARGET", "domains.cira.dev");
    vi.stubEnv("CIRA_APPS_DOMAIN", "cira.dev");
    vi.stubEnv("CIRA_PROXY_SECRET", "s".repeat(32));
  });

  it("adds a name as waiting, and opens nothing on it until its certificate is issued", async () => {
    const { addDomain, labelForDomain, refreshDomains } = await import("./app-domains");
    const added = await addDomain({ appId, userId, input: "Tools.Acme.com" });
    expect(added.ok && added.domain).toMatchObject({
      hostname: "tools.acme.com",
      state: "pending",
    });
    expect(await labelForDomain("tools.acme.com")).toBeNull();

    // The company points its CNAME at Cira, and Cloudflare issues the certificate.
    for (const held of cloudflare.values()) {
      if (held.hostname === "tools.acme.com")
        Object.assign(held, { status: "active", ssl: "active" });
    }
    await refreshDomains(new Date(), appId);
    expect(await labelForDomain("TOOLS.acme.com")).toBe("ledger--acme");
  });

  it("gives a name to one app only", async () => {
    const { addDomain } = await import("./app-domains");
    const again = await addDomain({ appId: otherAppId, userId, input: "tools.acme.com" });
    expect(!again.ok && again.error).toContain("already opens another app");
    expect(calls.some((call) => call.startsWith("POST /custom_hostnames"))).toBe(false);
  });

  it("refuses Cira's own names and a domain's root before asking Cloudflare", async () => {
    const { addDomain } = await import("./app-domains");
    for (const input of ["ledger--acme.cira.dev", "acme.com"]) {
      const result = await addDomain({ appId, userId, input });
      expect(result.ok, input).toBe(false);
    }
    expect(calls).toEqual([]);
  });

  it("lets a name never pointed at Cira go after a week", async () => {
    const { addDomain, refreshDomains, listDomains } = await import("./app-domains");
    await addDomain({ appId: otherAppId, userId, input: "payroll.acme.com" });
    const weekLater = new Date(Date.now() + 8 * 24 * 3600 * 1000);
    const { released } = await refreshDomains(weekLater, otherAppId);
    expect(released).toBe(1);
    expect(await listDomains(otherAppId)).toEqual([]);
    expect([...cloudflare.values()].map((held) => held.hostname)).not.toContain(
      "payroll.acme.com",
    );
  });

  it("lets every name go with the app, Cloudflare first", async () => {
    const { removeAppDomains } = await import("./app-domains");
    const { appDomains } = await import("@cira/db");
    expect(await removeAppDomains(appId)).toEqual({ ok: true });
    expect(
      await database.select().from(appDomains).where(eq(appDomains.appId, appId)),
    ).toEqual([]);
    expect(calls.some((call) => call.startsWith("DELETE /custom_hostnames/"))).toBe(true);
  });
});
