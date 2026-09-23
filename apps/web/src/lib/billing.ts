import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, spaces, stripeSetup } from "@cira/db";
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
const ALWAYS_ON_PRICE = "cira_team_always_on";

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
    // Already paying: a second checkout would be a second subscription, and
    // the company billed twice. The portal is where a running one is changed.
    if (summary.subscribed) return await portalFor(space);
    const bill = monthlyBill(PLANS.team, {
      seats: summary.people,
      workers: summary.workers,
      alwaysOn: summary.alwaysOn,
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
    let line = 1;
    if (summary.workers > 0) {
      form[`line_items[${line}][price]`] = await priceId(WORKER_PRICE);
      form[`line_items[${line}][quantity]`] = String(summary.workers);
      line += 1;
    }
    if (summary.alwaysOn > 0) {
      form[`line_items[${line}][price]`] = await priceId(ALWAYS_ON_PRICE);
      form[`line_items[${line}][quantity]`] = String(summary.alwaysOn);
    }

    // Two admins, or two tabs, clicking in the same minute get the same page
    // rather than two subscriptions.
    const minute = Math.floor(Date.now() / 60_000);
    const session = await stripe<{ url?: string }>(
      "checkout/sessions",
      "POST",
      form,
      `checkout-${space.id}-${minute}`,
    );
    return session.url === undefined
      ? { ok: false, error: "Stripe did not return a checkout page." }
      : { ok: true, url: session.url };
  } catch (error) {
    if (error instanceof MissingPriceError) {
      console.warn(error.message);
      return {
        ok: false,
        error: "Paying is not fully set up on this Cira yet. Its operator has been told.",
      };
    }
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
  } catch (error) {
    // A customer Stripe does not have is not a customer: forgotten here, so
    // the page offers to subscribe rather than a door that opens on an error.
    if (gone(error)) {
      await forgetSubscription(space.id);
      return {
        ok: false,
        error: "Stripe has no billing record for this space any more. Subscribe again.",
      };
    }
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
    ).catch(() => null);
    // Whoever is subscribing now is who Stripe should write to about it. The
    // address used to be set once, from whichever admin clicked first, and
    // failed-payment notices went on reaching them after they had left.
    if (known !== null && known.email !== billTo) {
      await stripe(`customers/${space.stripeCustomerId}`, "POST", {
        email: billTo,
      }).catch(() => undefined);
    }
    return space.stripeCustomerId;
  }
  const customer = await stripe<{ id: string }>(
    "customers",
    "POST",
    {
      name: space.name,
      email: billTo,
      "metadata[spaceId]": space.id,
      "metadata[spaceSlug]": space.slug,
    },
    // One customer per space, however many admins get here at once.
    `customer-${space.id}`,
  );
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
  cancel_at_period_end?: boolean;
  items?: { data?: Array<{ current_period_end?: number }> };
  metadata?: Record<string, string>;
  customer?: string;
}

export type Applied =
  | { kind: "ignored" }
  | { kind: "applied"; spaceId: string; before: string; after: string }
  | { kind: "cancelled-orphan" }
  | { kind: "cancelled-duplicate"; spaceId: string };

/**
 * Write down what a subscription now is, for the space it belongs to.
 *
 * What the event says is only a pointer. Stripe sends events in no promised
 * order and retries them later, so an old "updated" can arrive after a
 * "deleted", and a "created" (incomplete, mid card check) after the "updated"
 * that made it active. So the subscription is fetched as it is now, and that
 * is what is written.
 *
 * The space is found by the id put on the subscription when it was created,
 * falling back to the customer - a webhook is the one place Cira takes a fact
 * from outside, so it never trusts a slug in it. A subscription for a space
 * that no longer exists is cancelled, so nobody pays for nothing; a second
 * running subscription for a space already paying is cancelled, so nobody pays
 * twice.
 */
export async function applySubscription(event: StripeSubscription): Promise<Applied> {
  if (event.id === undefined) return { kind: "ignored" };
  const subscription =
    (await stripe<StripeSubscription>(`subscriptions/${event.id}`, "GET").catch(
      () => null,
    )) ?? event;

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

  const status = readStatus(subscription.status);
  const running = status !== null && RUNNING.includes(status);

  if (row === undefined) {
    if (!running) return { kind: "ignored" };
    await stripe(`subscriptions/${event.id}`, "DELETE").catch(() => undefined);
    console.warn(`stripe subscription ${event.id} cancelled: its space no longer exists`);
    return { kind: "cancelled-orphan" };
  }

  // A different subscription is already the space's and still running: this
  // one is a second, from two checkouts finished side by side.
  if (
    row.stripeSubscriptionId !== null &&
    row.stripeSubscriptionId !== event.id &&
    readStatus(row.subscriptionStatus) !== null &&
    RUNNING.includes(readStatus(row.subscriptionStatus)!)
  ) {
    if (running) {
      await stripe(`subscriptions/${event.id}`, "DELETE").catch(() => undefined);
      console.warn(`stripe subscription ${event.id} cancelled: ${row.id} already pays`);
      return { kind: "cancelled-duplicate", spaceId: row.id };
    }
    return { kind: "ignored" };
  }

  const until =
    subscription.current_period_end ?? subscription.items?.data?.[0]?.current_period_end;
  const plan = planFor(status);

  await database
    .update(spaces)
    .set({
      plan,
      subscriptionStatus: status,
      stripeSubscriptionId: event.id,
      paidUntil: until === undefined ? row.paidUntil : new Date(until * 1000),
    })
    .where(eq(spaces.id, row.id));

  return {
    kind: "applied",
    spaceId: row.id,
    before: row.subscriptionStatus ?? "none",
    after: status ?? "none",
  };
}

/** Statuses under which a subscription is still being paid, or chased. */
const RUNNING: readonly SubscriptionStatus[] = ["trialing", "active", "past_due"];

/**
 * Whether a space's subscription stands in the way of deleting it: one still
 * charging, that nobody has told to stop. One cancelled at the end of its
 * period is on its way out, and one that expired never started.
 */
export async function subscriptionBlocksDeletion(space: Space): Promise<boolean> {
  if (!billingConfigured() || space.stripeSubscriptionId === null) return false;
  const live = await stripe<StripeSubscription>(
    `subscriptions/${space.stripeSubscriptionId}`,
    "GET",
  ).catch(() => null);
  if (live === null) {
    const status = readStatus(space.subscriptionStatus);
    return status !== null && RUNNING.includes(status);
  }
  const status = readStatus(live.status);
  return (
    status !== null && RUNNING.includes(status) && live.cancel_at_period_end !== true
  );
}

/**
 * Close any checkout still open for this space's customer, so a tab left
 * open on Stripe cannot start a subscription after the space is gone.
 */
export async function expireOpenCheckouts(space: Space): Promise<void> {
  if (!billingConfigured() || space.stripeCustomerId === null) return;
  const open = await stripe<{ data?: Array<{ id: string }> }>(
    `checkout/sessions?customer=${encodeURIComponent(space.stripeCustomerId)}&status=open&limit=20`,
    "GET",
  ).catch(() => ({ data: [] }));
  for (const session of open.data ?? []) {
    await stripe(`checkout/sessions/${session.id}/expire`, "POST", {}).catch(
      () => undefined,
    );
  }
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
    alwaysOn: summary.alwaysOn,
  });

  let subscription;
  try {
    subscription = await stripe<{
      items?: {
        data?: Array<{ id: string; quantity?: number; price?: { lookup_key?: string } }>;
      };
    }>(`subscriptions/${subscriptionId}`, "GET");
  } catch (error) {
    if (!gone(error)) throw error;
    await forgetSubscription(spaceId);
    return "changed";
  }

  const items = subscription.items?.data ?? [];
  const changes: Record<string, string> = {};
  let index = 0;

  const quantities: Record<string, number> = {
    [SEAT_PRICE]: wanted.seats,
    [WORKER_PRICE]: summary.workers,
    [ALWAYS_ON_PRICE]: summary.alwaysOn,
  };
  // Every price Cira charges for, whether or not the subscription has a line
  // for it yet. Checkout only adds a line for what the space had then, so a
  // worker switched on afterwards used to have no line to count on - and was
  // never billed. A line that falls to nothing is removed rather than left at
  // zero on every invoice.
  for (const [key, quantity] of Object.entries(quantities)) {
    const item = items.find((i) => i.price?.lookup_key === key);
    if (item === undefined) {
      if (quantity === 0) continue;
      changes[`items[${index}][price]`] = await priceId(key);
      changes[`items[${index}][quantity]`] = String(quantity);
    } else if (quantity === 0 && key !== SEAT_PRICE) {
      changes[`items[${index}][id]`] = item.id;
      changes[`items[${index}][deleted]`] = "true";
    } else if ((item.quantity ?? 0) !== quantity) {
      changes[`items[${index}][id]`] = item.id;
      changes[`items[${index}][quantity]`] = String(quantity);
    } else {
      continue;
    }
    index += 1;
  }
  if (index === 0) return "same";

  await stripe(`subscriptions/${subscriptionId}`, "POST", {
    ...changes,
    proration_behavior: "create_prorations",
  });
  return "changed";
}

/** A price Cira charges for that nobody has created in Stripe yet. */
class MissingPriceError extends Error {
  constructor(lookupKey: string) {
    super(
      `No active Stripe price has the lookup key ${lookupKey}. Create it (README, Taking money).`,
    );
    this.name = "MissingPriceError";
  }
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
  if (id === undefined) throw new MissingPriceError(lookupKey);
  priceIds.set(lookupKey, id);
  return id;
}

/**
 * What Stripe refused, in the two facts Cira can act on. Its message is not
 * one of them: it names the account and the request, and belongs in a log
 * rather than in front of anybody.
 */
export class StripeCallError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super("Stripe refused the request.");
    this.name = "StripeCallError";
  }
}

/** Whether Stripe says the thing Cira asked about does not exist. */
function gone(error: unknown): boolean {
  return (
    error instanceof StripeCallError &&
    (error.status === 404 || error.code === "resource_missing")
  );
}

/**
 * Forget a subscription Stripe no longer has: deleted there, or belonging to
 * the other mode after a switch from test keys to live ones. The plan is left
 * alone - nothing a company runs is switched off because its payment record
 * moved - and its Billing page offers to subscribe again, which is the one
 * thing a stale record made impossible.
 */
async function forgetSubscription(spaceId: string): Promise<void> {
  await db()
    .update(spaces)
    .set({
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      subscriptionStatus: null,
      paidUntil: null,
    })
    .where(eq(spaces.id, spaceId));
  console.warn(`stripe: forgot a subscription it no longer has for ${spaceId}`);
}

async function stripe<T>(
  path: string,
  method: "GET" | "POST" | "DELETE",
  form?: Record<string, string>,
  idempotencyKey?: string,
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
      ...(idempotencyKey === undefined ? {} : { "idempotency-key": idempotencyKey }),
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
    const said = (await response.json().catch(() => null)) as {
      error?: { code?: string };
    } | null;
    throw new StripeCallError(response.status, said?.error?.code ?? null);
  }
  return (await response.json()) as T;
}

// -- Cira's own setup in Stripe ------------------------------------------------

/** Every event the webhook route acts on. */
export const WEBHOOK_EVENTS = [
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "checkout.session.completed",
  "invoice.payment_failed",
] as const;

/** The prices Cira bills with, made from the plan so the two cannot disagree. */
export function billedPrices(): Array<{
  lookupKey: string;
  name: string;
  cents: number;
}> {
  const team = PLANS.team;
  return [
    { lookupKey: SEAT_PRICE, name: "Seat", cents: team.perSeatMonthly * 100 },
    { lookupKey: WORKER_PRICE, name: "Worker", cents: team.workerMonthly * 100 },
    {
      lookupKey: ALWAYS_ON_PRICE,
      name: "App kept warm",
      cents: team.alwaysOnMonthly * 100,
    },
  ];
}

/** Test or live, by the key Cira holds. */
export function stripeMode(
  key: string | undefined = process.env["STRIPE_SECRET_KEY"],
): "test" | "live" {
  return /^(sk|rk)_live_/.test(key?.trim() ?? "") ? "live" : "test";
}

/** How often the setup is looked at again once it is right. */
const SETUP_RECHECK_MS = 6 * 3600_000;

export interface StripeSetupReport {
  mode: "test" | "live";
  pricesCreated: string[];
  eventsAdded: string[];
  webhook: "kept" | "updated" | "created";
}

/**
 * Make Stripe hold what Cira needs, in whichever mode its key is for: the
 * product and prices it bills with, and a webhook endpoint that sends every
 * event the webhook route acts on. Anything already there is left alone and
 * only what is missing is added, so it is safe to run again - which is what
 * turns going live into changing one key.
 *
 * An endpoint someone made by hand is kept and given any events it lacks;
 * its secret stays in the environment. One Cira makes has its secret kept in
 * `stripe_setup`, where the webhook route also looks.
 */
export async function ensureStripeSetup(
  now: Date = new Date(),
  { force = false }: { force?: boolean } = {},
): Promise<StripeSetupReport | null> {
  if (!billingConfigured()) return null;
  const mode = stripeMode();
  const database = db();
  const [known] = await database
    .select()
    .from(stripeSetup)
    .where(eq(stripeSetup.mode, mode))
    .limit(1);
  if (
    !force &&
    known !== undefined &&
    now.getTime() - known.checkedAt.getTime() < SETUP_RECHECK_MS
  ) {
    return null;
  }

  const report: StripeSetupReport = {
    mode,
    pricesCreated: [],
    eventsAdded: [],
    webhook: "kept",
  };

  // The product and prices, by lookup key.
  let product: string | null = null;
  for (const price of billedPrices()) {
    const found = await stripe<{ data?: Array<{ id: string }> }>(
      `prices?lookup_keys[]=${encodeURIComponent(price.lookupKey)}&active=true`,
      "GET",
    );
    if ((found.data?.length ?? 0) > 0) continue;
    product ??= await teamProduct();
    const made = await stripe<{ id: string }>(
      "prices",
      "POST",
      {
        product,
        currency: "usd",
        unit_amount: String(price.cents),
        "recurring[interval]": "month",
        lookup_key: price.lookupKey,
        nickname: price.name,
      },
      `cira-price-${mode}-${price.lookupKey}-${price.cents}`,
    );
    priceIds.set(price.lookupKey, made.id);
    report.pricesCreated.push(price.lookupKey);
  }

  // The webhook endpoint that points at this Cira.
  const url = `${appOrigin()}/api/stripe/webhook`;
  const endpoints = await stripe<{
    data?: Array<{ id: string; url: string; enabled_events: string[]; status?: string }>;
  }>("webhook_endpoints?limit=100", "GET");
  const endpoint = endpoints.data?.find((e) => e.url === url);
  let secret = known?.webhookSecret ?? null;
  let endpointId = known?.webhookEndpointId ?? null;

  if (endpoint !== undefined) {
    const has = new Set(endpoint.enabled_events);
    const missing = has.has("*") ? [] : WEBHOOK_EVENTS.filter((event) => !has.has(event));
    if (missing.length > 0) {
      const events = [...new Set([...endpoint.enabled_events, ...WEBHOOK_EVENTS])];
      await stripe(
        `webhook_endpoints/${endpoint.id}`,
        "POST",
        Object.fromEntries(events.map((event, i) => [`enabled_events[${i}]`, event])),
      );
      report.eventsAdded = missing;
      report.webhook = "updated";
    }
    endpointId = endpoint.id;
  } else {
    // None at this address. Made even when a secret is configured: that one
    // belongs to an endpoint somewhere else - after a switch to a live key,
    // the test account's - and a second delivery of an event is harmless,
    // because events are re-read and notices are claimed once.
    const made = await stripe<{ id: string; secret?: string }>(
      "webhook_endpoints",
      "POST",
      {
        url,
        description: "Cira",
        api_version: STRIPE_VERSION,
        ...Object.fromEntries(
          WEBHOOK_EVENTS.map((event, i) => [`enabled_events[${i}]`, event]),
        ),
      },
      `cira-webhook-${mode}-${url}`,
    );
    endpointId = made.id;
    secret = made.secret ?? secret;
    report.webhook = "created";
  }

  await database
    .insert(stripeSetup)
    .values({
      mode,
      webhookEndpointId: endpointId,
      webhookSecret: secret,
      checkedAt: now,
    })
    .onConflictDoUpdate({
      target: stripeSetup.mode,
      set: { webhookEndpointId: endpointId, webhookSecret: secret, checkedAt: now },
    });
  // Names only, and only when Stripe was changed: whoever runs Cira should see
  // that it happened, and nothing when it did not.
  if (report.pricesCreated.length > 0 || report.webhook !== "kept") {
    console.warn(
      `stripe setup (${mode}): prices made [${report.pricesCreated.join(", ")}], ` +
        `webhook ${report.webhook}${report.eventsAdded.length > 0 ? ` +[${report.eventsAdded.join(", ")}]` : ""}`,
    );
  }
  return report;
}

/** The product Cira's prices hang off, found by its mark or made once. */
async function teamProduct(): Promise<string> {
  const found = await stripe<{ data?: Array<{ id: string }> }>(
    `products/search?query=${encodeURIComponent("metadata['cira']:'team' AND active:'true'")}`,
    "GET",
  );
  const id = found.data?.[0]?.id;
  if (id !== undefined) return id;
  const made = await stripe<{ id: string }>(
    "products",
    "POST",
    { name: "Cira Team", "metadata[cira]": "team" },
    "cira-product-team",
  );
  return made.id;
}

/** Every secret a webhook may be signed with: the configured one, and Cira's own. */
export async function webhookSecrets(): Promise<string[]> {
  const configured = process.env["STRIPE_WEBHOOK_SECRET"]?.trim();
  const [own] = await db()
    .select({ secret: stripeSetup.webhookSecret })
    .from(stripeSetup)
    .where(eq(stripeSetup.mode, stripeMode()))
    .limit(1);
  return [configured, own?.secret ?? undefined].filter(
    (secret): secret is string =>
      secret !== undefined && secret !== null && secret !== "",
  );
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
  const pieces = args.header.split(",").map((piece) => {
    const at = piece.indexOf("=");
    return [piece.slice(0, at).trim(), piece.slice(at + 1).trim()] as const;
  });
  const timestamp = Number(pieces.find(([key]) => key === "t")?.[1]);
  // Every v1, not the last one: while a webhook secret is being rotated,
  // Stripe signs with both, and the matching one need not come last.
  const signatures = pieces.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!Number.isFinite(timestamp) || signatures.length === 0) return false;

  const age = Math.abs((args.now ?? new Date()).getTime() / 1000 - timestamp);
  if (age > (args.toleranceSeconds ?? 300)) return false;

  const expected = Buffer.from(
    createHmac("sha256", args.secret)
      .update(`${timestamp}.${args.payload}`)
      .digest("hex"),
    "utf8",
  );
  return signatures.some((signature) => {
    const given = Buffer.from(signature, "utf8");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export type { SubscriptionStatus };
