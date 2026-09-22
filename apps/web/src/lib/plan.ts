import "server-only";

import { and, count, eq, gt } from "drizzle-orm";
import { apps, db, memberships, processes, spaces } from "@cira/db";
import {
  effectivePlan,
  monthlyBill,
  trialEndsAt,
  type Bill,
  type Plan,
} from "@cira/core";
import { readStatus, type SubscriptionStatus } from "@/lib/billing-rules";

/**
 * Which plan a space is on, and therefore what it may do.
 *
 * Read here rather than taken from the defaults, so that a limit a plan sets
 * is the limit the server keeps. One query, on the paths that enforce
 * something - taking another app, switching on another worker - which are
 * rare and already doing more work than this.
 */
export async function planForSpace(spaceId: string): Promise<Plan> {
  const [row] = await db()
    .select({ plan: spaces.plan, createdAt: spaces.createdAt })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1);
  return effectivePlan(row?.plan, row?.createdAt ?? new Date(0));
}

export interface PlanSummary {
  plan: Plan;
  /** People who can sign in to the space; every one is a seat. */
  people: number;
  /** Workers switched on, which are what a plan charges for beyond seats. */
  workers: number;
  /** Apps kept warm, each holding an instance open and charged for. */
  alwaysOn: number;
  bill: Bill;
  /** When a trial runs out, or ran out; null on a paid plan. */
  trialEndsAt: Date | null;
  /** Stripe's word for the subscription. */
  status: SubscriptionStatus | null;
  /**
   * Whether a subscription is running now - paid, or behind on a payment -
   * which is what decides between offering checkout and the billing portal.
   * Having once been a Stripe customer is not it: someone who abandoned a
   * checkout, or cancelled, has to be able to subscribe again.
   */
  subscribed: boolean;
  /** Whether Stripe knows this company at all, so the portal has invoices to show. */
  customer: boolean;
  /** What the subscription is paid up to. */
  paidUntil: Date | null;
}

/** What this space is on, what it is using of it, and what that would cost. */
export async function planSummary(spaceId: string): Promise<PlanSummary> {
  const database = db();
  const [[space], [people], [workers], [warm]] = await Promise.all([
    database
      .select({
        plan: spaces.plan,
        createdAt: spaces.createdAt,
        status: spaces.subscriptionStatus,
        customerId: spaces.stripeCustomerId,
        paidUntil: spaces.paidUntil,
      })
      .from(spaces)
      .where(eq(spaces.id, spaceId))
      .limit(1),
    database
      .select({ n: count() })
      .from(memberships)
      .where(eq(memberships.spaceId, spaceId)),
    database
      .select({ n: count() })
      .from(processes)
      .innerJoin(apps, eq(apps.id, processes.appId))
      .where(
        and(
          eq(apps.spaceId, spaceId),
          eq(processes.kind, "worker"),
          eq(processes.enabled, true),
        ),
      ),
    database
      .select({ n: count() })
      .from(apps)
      .where(and(eq(apps.spaceId, spaceId), gt(apps.minInstances, 0))),
  ]);

  const plan = effectivePlan(space?.plan, space?.createdAt ?? new Date(0));
  const status = readStatus(space?.status);
  const use = {
    seats: people?.n ?? 0,
    workers: workers?.n ?? 0,
    alwaysOn: warm?.n ?? 0,
  };
  return {
    plan,
    people: use.seats,
    workers: use.workers,
    alwaysOn: use.alwaysOn,
    bill: monthlyBill(plan, use),
    trialEndsAt:
      plan.id === "team" || space === undefined ? null : trialEndsAt(space.createdAt),
    status,
    subscribed:
      status === "active" ||
      status === "trialing" ||
      status === "past_due" ||
      status === "unpaid",
    customer: (space?.customerId ?? null) !== null,
    paidUntil: space?.paidUntil ?? null,
  };
}
