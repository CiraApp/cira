import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, spaces } from "@cira/db";
import { monthlyBill, planOf, PLANS, type Space } from "@cira/core";
import { appOrigin } from "@/lib/email";
import { planSummary } from "@/lib/plan";
import { planFor, readStatus, type SubscriptionStatus } from "@/lib/billing-rules";

/**
 * Taking money, through Stripe.
 *
 * Cira never sees a card: a person is sent to Stripe's own checkout and comes
 * back, and everything after that arrives as a webhook. Stripe holds the
 * money, Cira holds what the subscription means - which plan a space is on,
 * and therefore what it may do - and `plans.ts` remains the only place that
 * says what either is worth.
 *
 * Talked to over its REST API rather than through its SDK: three calls and a
 * signature check, against a versioned API that is stable, is not worth a
 * dependency that ships into every server bundle.
 */

const STRIPE_API = "https://api.stripe.com/v1";
/** Pinned, so a change at Stripe cannot quietly change what Cira reads. */
const STRIPE_VERSION = "2025-08-27.basil";

/** The prices in Stripe, found by the keys Cira gave them when they were made. */
const SEAT_PRICE = "cira_team_seat";
const WORKER_PRICE = "cira_team_worker";

export function billingConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const key = env["STRIPE_SECRET_KEY"]?.trim();
  return key !== undefined && key !== "";
}

export type BillingOutcome = { ok: true; url: string } | { ok: false; error: string };

/**
 * Where to send someone to start paying: Stripe's checkout, with a line for
 * the seats this space has and one for each worker it runs, so the first
 * invoice matches what the usage page said it would be.
 */
export async function checkoutFor(space: Space, billTo: string): Promise<BillingOutcome> {
  if (!billingConfigured()) {
    return { ok: false, error: "Paying is not switched on for this Cira yet." };
  }
  try {
    const summary = await planSummary(space.id);
    const bill = monthlyBill(PLANS.team, {
      seats: summary.people,
      workers: summary.workers,
    });
    const customer = await customerFor(space, billTo);
    const back = `${appOrigin()}/${space.slug}/~/usage`;

    const form: Record<string, string> = {
      mode: "subscription",
      customer,
      success_url: `${back}?paid=1`,
      cancel_url: back,
      allow_promotion_codes: "true",
      "line_items[0][price]": await priceId(SEAT_PRICE),
      "line_items[0][quantity]": String(bill.seats),
      "subscription_data[metadata][spaceId]": space.id,
      "subscription_data[metadata][spaceSlug]": space.slug,
    };
    if (summary.workers > 0) {
      form["line_items[1][price]"] = await priceId(WORKER_PRICE);
      form["line_items[1][quantity]"] = String(summary.workers);
    }

    const session = await stripe<{ url?: string }>("checkout/sessions", "POST", form);
    return session.url === undefined
      ? { ok: false, error: "Stripe did not return a checkout page." }
      : { ok: true, url: session.url };
  } catch {
    return { ok: false, error: "Stripe could not be reached just now." };
  }
}

/** Where to send someone to change a card, see invoices, or stop paying. */
export async function portalFor(space: Space): Promise<BillingOutcome> {
  if (space.stripeCustomerId === null || !billingConfigured()) {
    return { ok: false, error: "This space has never been subscribed." };
  }
  try {
    const session = await stripe<{ url?: string }>("billing_portal/sessions", "POST", {
      customer: space.stripeCustomerId,
      return_url: `${appOrigin()}/${space.slug}/~/usage`,
    });
    return session.url === undefined
      ? { ok: false, error: "Stripe did not return a billing page." }
      : { ok: true, url: session.url };
  } catch {
    return { ok: false, error: "Stripe could not be reached just now." };
  }
}

/**
 * The customer Stripe knows this company as, made once and remembered, with
 * the address of whoever is paying on it: Stripe fills the checkout in from
 * it, and sends receipts and failed-payment notices to it, which are no use
 * addressed to nobody. An existing customer that has none is given one.
 */
async function customerFor(space: Space, billTo: string): Promise<string> {
  if (space.stripeCustomerId !== null && space.stripeCustomerId !== "") {
    const known = await stripe<{ email?: string | null }>(
      `customers/${space.stripeCustomerId}`,
      "GET",
    ).catch(() => ({ email: "kept" }) as { email?: string | null });
    if (known.email === null || known.email === undefined || known.email === "") {
      await stripe(`customers/${space.stripeCustomerId}`, "POST", {
        email: billTo,
      }).catch(() => undefined);
    }
    return space.stripeCustomerId;
  }
  const customer = await stripe<{ id: string }>("customers", "POST", {
    name: space.name,
    email: billTo,
    "metadata[spaceId]": space.id,
    "metadata[spaceSlug]": space.slug,
  });
  await db()
    .update(spaces)
    .set({ stripeCustomerId: customer.id })
    .where(eq(spaces.id, space.id));
  return customer.id;
}

interface StripeSubscription {
  id?: string;
  status?: string;
  current_period_end?: number;
  items?: { data?: Array<{ current_period_end?: number }> };
  metadata?: Record<string, string>;
  customer?: string;
}

/**
 * Write down what a subscription now is, for the space it belongs to.
 *
 * The space is found by the id put on the subscription when it was created,
 * falling back to the customer - a webhook is the one place Cira takes a fact
 * from outside, so it never trusts a slug in it.
 */
export async function applySubscription(subscription: StripeSubscription): Promise<void> {
  const database = db();
  const spaceId = subscription.metadata?.["spaceId"];
  const [row] =
    spaceId !== undefined
      ? await database.select().from(spaces).where(eq(spaces.id, spaceId)).limit(1)
      : subscription.customer !== undefined
        ? await database
            .select()
            .from(spaces)
            .where(eq(spaces.stripeCustomerId, subscription.customer))
            .limit(1)
        : [];
  if (row === undefined) return;

  const status = readStatus(subscription.status);
  const until =
    subscription.current_period_end ?? subscription.items?.data?.[0]?.current_period_end;

  await database
    .update(spaces)
    .set({
      plan: planFor(status),
      subscriptionStatus: status,
      stripeSubscriptionId: subscription.id ?? row.stripeSubscriptionId,
      paidUntil: until === undefined ? row.paidUntil : new Date(until * 1000),
    })
    .where(eq(spaces.id, row.id));
}

/**
 * Keep a subscription's quantities in step with what a space actually has:
 * one seat per person, one line per worker. Run from the watcher, so a
 * company that grows is billed for what it grew to without anyone doing
 * anything, and one that shrinks stops paying for people who left.
 */
export async function syncQuantities(
  spaceId: string,
): Promise<"changed" | "same" | "skipped"> {
  if (!billingConfigured()) return "skipped";
  const [space] = await db().select().from(spaces).where(eq(spaces.id, spaceId)).limit(1);
  const subscriptionId = space?.stripeSubscriptionId ?? null;
  if (space === undefined || subscriptionId === null) return "skipped";
  if (planOf(space.plan).id !== "team") return "skipped";

  const summary = await planSummary(spaceId);
  const wanted = monthlyBill(PLANS.team, {
    seats: summary.people,
    workers: summary.workers,
  });

  const subscription = await stripe<{
    items?: {
      data?: Array<{ id: string; quantity?: number; price?: { lookup_key?: string } }>;
    };
  }>(`subscriptions/${subscriptionId}`, "GET");

  const items = subscription.items?.data ?? [];
  const changes: Record<string, string> = {};
  let index = 0;
  let changed = false;

  for (const item of items) {
    const isSeat = item.price?.lookup_key === SEAT_PRICE;
    const quantity = isSeat ? wanted.seats : summary.workers;
    if ((item.quantity ?? 0) === quantity) continue;
    changes[`items[${index}][id]`] = item.id;
    changes[`items[${index}][quantity]`] = String(quantity);
    index += 1;
    changed = true;
  }
  if (!changed) return "same";

  await stripe(`subscriptions/${subscriptionId}`, "POST", {
    ...changes,
    proration_behavior: "create_prorations",
  });
  return "changed";
}

/** A price by the key it was created with, so no id has to live in the code. */
const priceIds = new Map<string, string>();
async function priceId(lookupKey: string): Promise<string> {
  const known = priceIds.get(lookupKey);
  if (known !== undefined) return known;
  const found = await stripe<{ data?: Array<{ id: string }> }>(
    `prices?lookup_keys[]=${encodeURIComponent(lookupKey)}&active=true`,
    "GET",
  );
  const id = found.data?.[0]?.id;
  if (id === undefined) throw new Error(`No Stripe price is set up for ${lookupKey}.`);
  priceIds.set(lookupKey, id);
  return id;
}

async function stripe<T>(
  path: string,
  method: "GET" | "POST",
  form?: Record<string, string>,
): Promise<T> {
  const key = process.env["STRIPE_SECRET_KEY"]?.trim() ?? "";
  const response = await fetch(`${STRIPE_API}/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      "stripe-version": STRIPE_VERSION,
      ...(form === undefined
        ? {}
        : { "content-type": "application/x-www-form-urlencoded" }),
    },
    ...(form === undefined ? {} : { body: new URLSearchParams(form).toString() }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    // Stripe's message names the account and the request; its status is what
    // Cira can act on, and the request id is what support asks for.
    console.warn(
      `stripe ${path} refused: ${response.status} ${response.headers.get("request-id") ?? ""}`,
    );
    throw new Error("Stripe refused the request.");
  }
  return (await response.json()) as T;
}

/**
 * Whether a webhook really came from Stripe.
 *
 * Its scheme, implemented here rather than pulled in: the signed payload is
 * the timestamp, a dot, and the body exactly as it arrived, and a signature
 * is compared in constant time. An old one is refused, so a captured webhook
 * cannot be replayed later.
 */
export function verifyWebhook(args: {
  payload: string;
  header: string | null;
  secret: string;
  now?: Date;
  toleranceSeconds?: number;
}): boolean {
  if (args.header === null) return false;
  const parts = new Map(
    args.header.split(",").map((piece) => {
      const [key, value] = piece.split("=");
      return [key?.trim() ?? "", value?.trim() ?? ""] as const;
    }),
  );
  const timestamp = Number(parts.get("t"));
  const signature = parts.get("v1");
  if (!Number.isFinite(timestamp) || signature === undefined) return false;

  const age = Math.abs((args.now ?? new Date()).getTime() / 1000 - timestamp);
  if (age > (args.toleranceSeconds ?? 300)) return false;

  const expected = createHmac("sha256", args.secret)
    .update(`${timestamp}.${args.payload}`)
    .digest("hex");
  const given = Buffer.from(signature, "utf8");
  const mine = Buffer.from(expected, "utf8");
  return given.length === mine.length && timingSafeEqual(given, mine);
}

export type { SubscriptionStatus };
