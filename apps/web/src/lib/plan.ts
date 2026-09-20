import "server-only";

import { and, count, eq } from "drizzle-orm";
import { apps, db, memberships, processes, spaces } from "@cira/db";
import { monthlyBill, planOf, type Bill, type Plan } from "@cira/core";
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
    .select({ plan: spaces.plan })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1);
  return planOf(row?.plan);
}

export interface PlanSummary {
  plan: Plan;
  /** People who can sign in to the space; every one is a seat. */
  people: number;
  /** Workers switched on, which are what a plan charges for beyond seats. */
  workers: number;
  bill: Bill;
  /** When a trial runs out; null on a paid plan. */
  trialEndsAt: Date | null;
  /** Stripe's word for the subscription, and whether there is one at all. */
  status: SubscriptionStatus | null;
  subscribed: boolean;
  /** What the subscription is paid up to. */
  paidUntil: Date | null;
}

/** What this space is on, what it is using of it, and what that would cost. */
export async function planSummary(spaceId: string): Promise<PlanSummary> {
  const database = db();
  const [[space], [people], [workers]] = await Promise.all([
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
  ]);

  const plan = planOf(space?.plan);
  const use = { seats: people?.n ?? 0, workers: workers?.n ?? 0 };
  return {
    plan,
    people: use.seats,
    workers: use.workers,
    bill: monthlyBill(plan, use),
    trialEndsAt:
      plan.trialDays === 0 || space === undefined
        ? null
        : new Date(space.createdAt.getTime() + plan.trialDays * 24 * 3600_000),
    status: readStatus(space?.status),
    subscribed: (space?.customerId ?? null) !== null,
    paidUntil: space?.paidUntil ?? null,
  };
}
