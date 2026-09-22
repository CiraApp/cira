import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { newId } from "@cira/core";
import type * as CiraDb from "@cira/db";
import { migratedTestDatabase } from "../../../../packages/db/src/test-database.js";

/**
 * What Stripe says, arriving at a space: which plan it lands on, what it may
 * do afterwards, and the things a real company lives through - events out of
 * order, two checkouts at once, a space deleted while a checkout was open,
 * workers switched on after it subscribed.
 *
 * Stripe is a small fake that keeps subscriptions and records every request,
 * so each flow is followed as state rather than as mocked calls.
 */

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];
const hasDatabase = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== "";

let database: Awaited<ReturnType<typeof migratedTestDatabase>>;

vi.mock("@cira/db", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDb>();
  return { ...actual, db: () => database };
});

interface FakeSubscription {
  id: string;
  status: string;
  customer?: string;
  metadata?: Record<string, string>;
  current_period_end?: number;
  cancel_at_period_end?: boolean;
  items: { data: Array<{ id: string; quantity: number; price: { lookup_key: string } }> };
}

/** Stripe, as far as subscriptions and prices go. */
const stripe = {
  subscriptions: new Map<string, FakeSubscription>(),
  requests: [] as Array<{ method: string; path: string; body: URLSearchParams }>,
  /** Lookup keys with no price yet, for the setup tests. Empty: every key has one. */
  missingPrices: new Set<string>(),
  products: [] as Array<{ id: string; metadata: Record<string, string> }>,
  endpoints: [] as Array<{ id: string; url: string; enabled_events: string[] }>,
};

function serveStripe(): void {
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v1\//, "");
    const method = init?.method ?? "GET";
    const body = new URLSearchParams(typeof init?.body === "string" ? init.body : "");
    stripe.requests.push({ method, path, body });
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), { status });

    if (path === "prices" && method === "GET") {
      const key = url.searchParams.get("lookup_keys[]") ?? "";
      return json({
        data: stripe.missingPrices.has(key) ? [] : [{ id: `price_${key}` }],
      });
    }
    if (path === "prices" && method === "POST") {
      const key = body.get("lookup_key") ?? "";
      stripe.missingPrices.delete(key);
      return json({ id: `price_${key}` });
    }
    if (path === "products/search") {
      return json({ data: stripe.products.filter((p) => p.metadata["cira"] === "team") });
    }
    if (path === "products" && method === "POST") {
      const product = {
        id: `prod_${stripe.products.length + 1}`,
        metadata: { cira: "team" },
      };
      stripe.products.push(product);
      return json(product);
    }
    if (path === "webhook_endpoints" && method === "GET") {
      return json({ data: stripe.endpoints });
    }
    if (path === "webhook_endpoints" && method === "POST") {
      const events = [...body.entries()]
        .filter(([k]) => k.startsWith("enabled_events"))
        .map(([, v]) => v);
      const made = {
        id: `we_${stripe.endpoints.length + 1}`,
        url: body.get("url")!,
        enabled_events: events,
      };
      stripe.endpoints.push(made);
      return json({ ...made, secret: "whsec_made_by_cira" });
    }
    const endpoint = /^webhook_endpoints\/(.+)$/.exec(path);
    if (endpoint !== null && method === "POST") {
      const found = stripe.endpoints.find((e) => e.id === endpoint[1]);
      if (found === undefined) return json({ error: {} }, 404);
      found.enabled_events = [...body.entries()]
        .filter(([k]) => k.startsWith("enabled_events"))
        .map(([, v]) => v);
      return json(found);
    }
    const sub = /^subscriptions\/([^/]+)$/.exec(path);
    if (sub !== null) {
      const found = stripe.subscriptions.get(sub[1]!);
      if (found === undefined) return json({ error: {} }, 404);
      if (method === "DELETE") {
        found.status = "canceled";
        return json(found);
      }
      if (method === "POST") {
        // Apply item changes the way Stripe does.
        for (
          let i = 0;
          body.has(`items[${i}][id]`) || body.has(`items[${i}][price]`);
          i++
        ) {
          const id = body.get(`items[${i}][id]`);
          if (id === null) {
            found.items.data.push({
              id: `si_${i}_${Date.now()}`,
              quantity: Number(body.get(`items[${i}][quantity]`)),
              price: {
                lookup_key: body.get(`items[${i}][price]`)!.replace(/^price_/, ""),
              },
            });
          } else if (body.get(`items[${i}][deleted]`) === "true") {
            found.items.data = found.items.data.filter((item) => item.id !== id);
          } else {
            const item = found.items.data.find((x) => x.id === id);
            if (item !== undefined)
              item.quantity = Number(body.get(`items[${i}][quantity]`));
          }
        }
        return json(found);
      }
      return json(found);
    }
    return json({ error: {} }, 404);
  });
}

const spaceId = newId("space");
const strangerId = newId("space");

const subscription = (over: Partial<FakeSubscription> = {}): FakeSubscription => ({
  id: "sub_1",
  status: "active",
  metadata: { spaceId },
  current_period_end: 1_790_000_000,
  items: {
    data: [{ id: "si_seat", quantity: 5, price: { lookup_key: "cira_team_seat" } }],
  },
  ...over,
});

describe.skipIf(!hasDatabase)("billing", () => {
  beforeAll(async () => {
    database = await migratedTestDatabase(TEST_DATABASE_URL as string, "cira_billing");
    const { spaces } = await import("@cira/db");
    await database.insert(spaces).values([
      {
        id: spaceId,
        name: "Acme",
        slug: "acme",
        domain: "acme.test",
        stripeCustomerId: "cus_acme",
      },
      { id: strangerId, name: "Other", slug: "other", domain: "other.test" },
    ]);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
  }, 60_000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await database?.end();
  });

  beforeEach(async () => {
    const { spaces } = await import("@cira/db");
    await database
      .update(spaces)
      .set({ plan: "trial", subscriptionStatus: null, stripeSubscriptionId: null })
      .where(eq(spaces.id, spaceId));
    stripe.subscriptions.clear();
    stripe.requests.length = 0;
    stripe.missingPrices.clear();
    stripe.products.length = 0;
    stripe.endpoints.length = 0;
    serveStripe();
  });

  const spaceRow = async (id = spaceId) => {
    const { spaces } = await import("@cira/db");
    const [row] = await database.select().from(spaces).where(eq(spaces.id, id));
    return row;
  };

  describe("applySubscription", () => {
    it("puts a space on its plan when a subscription starts", async () => {
      const { applySubscription } = await import("./billing");
      stripe.subscriptions.set("sub_1", subscription());
      await applySubscription({ id: "sub_1" });
      expect(await spaceRow()).toMatchObject({
        plan: "team",
        subscriptionStatus: "active",
        stripeSubscriptionId: "sub_1",
        paidUntil: new Date(1_790_000_000 * 1000),
      });
    });

    it("writes what the subscription is now, not what a late event said", async () => {
      const { applySubscription } = await import("./billing");
      // Deleted at Stripe; an old "active" update arrives afterwards.
      stripe.subscriptions.set("sub_1", subscription({ status: "canceled" }));
      await applySubscription({ id: "sub_1", status: "active", metadata: { spaceId } });
      expect(await spaceRow()).toMatchObject({
        plan: "trial",
        subscriptionStatus: "canceled",
      });
    });

    it("leaves a company on its plan while a payment is being retried", async () => {
      const { applySubscription } = await import("./billing");
      stripe.subscriptions.set("sub_1", subscription({ status: "past_due" }));
      await applySubscription({ id: "sub_1" });
      expect(await spaceRow()).toMatchObject({
        plan: "team",
        subscriptionStatus: "past_due",
      });
    });

    it("stops the paid plan once Stripe gives up and marks it unpaid", async () => {
      const { applySubscription } = await import("./billing");
      stripe.subscriptions.set("sub_1", subscription({ status: "unpaid" }));
      await applySubscription({ id: "sub_1" });
      expect(await spaceRow()).toMatchObject({
        plan: "trial",
        subscriptionStatus: "unpaid",
      });
    });

    it("finds the space by its customer when the subscription names none", async () => {
      const { applySubscription } = await import("./billing");
      stripe.subscriptions.set(
        "sub_2",
        subscription({ id: "sub_2", metadata: {}, customer: "cus_acme" }),
      );
      await applySubscription({ id: "sub_2" });
      expect(await spaceRow()).toMatchObject({
        plan: "team",
        stripeSubscriptionId: "sub_2",
      });
    });

    it("cancels a subscription for a space that no longer exists", async () => {
      const { applySubscription } = await import("./billing");
      stripe.subscriptions.set(
        "sub_x",
        subscription({ id: "sub_x", metadata: { spaceId: newId("space") } }),
      );
      expect((await applySubscription({ id: "sub_x" })).kind).toBe("cancelled-orphan");
      expect(stripe.subscriptions.get("sub_x")?.status).toBe("canceled");
      expect(await spaceRow(strangerId)).toMatchObject({ plan: "trial" });
    });

    it("cancels a second subscription for a space that already pays", async () => {
      const { applySubscription } = await import("./billing");
      stripe.subscriptions.set("sub_1", subscription());
      await applySubscription({ id: "sub_1" });
      stripe.subscriptions.set("sub_2", subscription({ id: "sub_2" }));

      expect((await applySubscription({ id: "sub_2" })).kind).toBe("cancelled-duplicate");
      expect(stripe.subscriptions.get("sub_2")?.status).toBe("canceled");
      // The first still stands, and the space still names it.
      expect(await spaceRow()).toMatchObject({
        stripeSubscriptionId: "sub_1",
        plan: "team",
      });
    });
  });

  /**
   * Stripe set up by Cira itself, so going live is changing one key: the
   * prices it bills with, made from the plan, and a webhook endpoint sending
   * every event the webhook route acts on.
   */
  describe("ensureStripeSetup", () => {
    const force = { force: true };

    it("makes the prices and the webhook a new account lacks, and keeps the secret", async () => {
      const { ensureStripeSetup, webhookSecrets, WEBHOOK_EVENTS } =
        await import("./billing");
      stripe.missingPrices = new Set([
        "cira_team_seat",
        "cira_team_worker",
        "cira_team_always_on",
      ]);
      vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");

      const report = await ensureStripeSetup(new Date(), force);
      expect(report).toMatchObject({
        mode: "test",
        pricesCreated: ["cira_team_seat", "cira_team_worker", "cira_team_always_on"],
        webhook: "created",
      });
      const seat = stripe.requests.find(
        (r) =>
          r.path === "prices" &&
          r.method === "POST" &&
          r.body.get("lookup_key") === "cira_team_seat",
      );
      expect(seat?.body.get("unit_amount")).toBe("1200");
      expect(seat?.body.get("recurring[interval]")).toBe("month");
      // One product, however many prices hang off it.
      expect(stripe.products).toHaveLength(1);
      expect(stripe.endpoints[0]?.enabled_events).toEqual([...WEBHOOK_EVENTS]);
      expect(await webhookSecrets()).toEqual(["whsec_made_by_cira"]);
      vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
    });

    it("gives an endpoint someone made by hand the events it lacks, and nothing else", async () => {
      const { ensureStripeSetup } = await import("./billing");
      const { appOrigin } = await import("./email");
      stripe.endpoints.push({
        id: "we_hand",
        url: `${appOrigin()}/api/stripe/webhook`,
        enabled_events: ["customer.subscription.updated", "charge.refunded"],
      });

      const report = await ensureStripeSetup(new Date(), force);
      expect(report?.webhook).toBe("updated");
      expect(report?.eventsAdded).toContain("checkout.session.completed");
      expect(report?.eventsAdded).toContain("invoice.payment_failed");
      // What it was already sent stays.
      expect(stripe.endpoints[0]?.enabled_events).toContain("charge.refunded");
      expect(report?.pricesCreated).toEqual([]);

      // Right now, so the next pass changes nothing.
      const again = await ensureStripeSetup(new Date(), force);
      expect(again).toMatchObject({
        webhook: "kept",
        eventsAdded: [],
        pricesCreated: [],
      });
    });

    it("looks again only every few hours once it is right", async () => {
      const { ensureStripeSetup } = await import("./billing");
      const now = new Date();
      await ensureStripeSetup(now, force);
      stripe.requests.length = 0;
      expect(await ensureStripeSetup(new Date(now.getTime() + 60_000))).toBeNull();
      expect(stripe.requests).toHaveLength(0);
    });

    it("tells a live key from a test one", async () => {
      const { stripeMode } = await import("./billing");
      expect(stripeMode("sk_live_abc")).toBe("live");
      expect(stripeMode("rk_live_abc")).toBe("live");
      expect(stripeMode("sk_test_abc")).toBe("test");
    });
  });

  describe("syncQuantities", () => {
    it("adds a line for workers switched on after checkout, and removes it when they go", async () => {
      const { applySubscription, syncQuantities } = await import("./billing");
      const { apps, processes, users, memberships } = await import("@cira/db");
      stripe.subscriptions.set("sub_1", subscription());
      await applySubscription({ id: "sub_1" });

      const owner = newId("user");
      await database
        .insert(users)
        .values({ id: owner, externalId: "b1", name: "O", email: "o@acme.test" });
      await database
        .insert(memberships)
        .values({ id: newId("membership"), userId: owner, spaceId, role: "owner" });
      const appId = newId("app");
      await database
        .insert(apps)
        .values({ id: appId, spaceId, name: "Queue", slug: "queue", ownerUserId: owner });
      const processId = newId("process");
      await database.insert(processes).values({
        id: processId,
        appId,
        spaceId,
        name: "worker",
        kind: "worker",
        command: "python w.py",
        serviceSlug: "app",
        source: "Procfile",
        enabled: true,
      });

      expect(await syncQuantities(spaceId)).toBe("changed");
      const lines = stripe.subscriptions.get("sub_1")!.items.data;
      expect(lines.find((l) => l.price.lookup_key === "cira_team_worker")?.quantity).toBe(
        1,
      );

      await database
        .update(processes)
        .set({ enabled: false })
        .where(eq(processes.id, processId));
      expect(await syncQuantities(spaceId)).toBe("changed");
      expect(
        stripe.subscriptions
          .get("sub_1")!
          .items.data.some((l) => l.price.lookup_key === "cira_team_worker"),
      ).toBe(false);
      expect(await syncQuantities(spaceId)).toBe("same");
    });
  });
});

describe("verifyWebhook", () => {
  it("accepts a signature from either secret while one is being rotated", async () => {
    const { createHmac } = await import("node:crypto");
    const { verifyWebhook } = await import("./billing");
    const now = new Date("2026-09-22T00:00:00Z");
    const t = Math.floor(now.getTime() / 1000);
    const payload = '{"id":"evt_1"}';
    const sign = (secret: string) =>
      createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");

    // Stripe signs with the new secret and the old one; ours is the old.
    const header = `t=${t},v1=${sign("whsec_new")},v1=${sign("whsec_old")}`;
    expect(verifyWebhook({ payload, header, secret: "whsec_old", now })).toBe(true);
    expect(verifyWebhook({ payload, header, secret: "whsec_other", now })).toBe(false);
  });
});
