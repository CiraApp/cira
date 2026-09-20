import type { PlanId } from "@cira/core";

/**
 * What a subscription's state means for a company, decided from values alone.
 *
 * Kept away from Stripe and the database so the one decision that matters -
 * what a company may still do when a payment has not gone through - can be
 * read in one place and tested without either.
 *
 * A failed payment does not take a company's software away. Cira is where a
 * company's internal apps live; switching them off over an expired card would
 * do more damage to them than the unpaid month does to Cira. So a subscription
 * that is behind keeps working and says so, loudly, and only one that is
 * actually over falls back to what a trial allows.
 */

/** Stripe's subscription statuses, as Cira reads them. */
export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired"
  | "canceled"
  | "paused";

export function planFor(status: SubscriptionStatus | null): PlanId {
  switch (status) {
    case "trialing":
    case "active":
    case "past_due":
    case "unpaid":
      return "team";
    default:
      return "trial";
  }
}

export interface BillingNotice {
  tone: "warn" | "stop";
  message: string;
}

/** What to say at the top of the page, or null when there is nothing to say. */
export function noticeFor(status: SubscriptionStatus | null): BillingNotice | null {
  switch (status) {
    case "past_due":
    case "unpaid":
      return {
        tone: "warn",
        message:
          "The last payment did not go through. Everything keeps running for now; " +
          "update the card to keep it that way.",
      };
    case "incomplete":
      return {
        tone: "warn",
        message: "Payment was started but never finished, so nothing is subscribed yet.",
      };
    case "canceled":
    case "incomplete_expired":
    case "paused":
      return {
        tone: "stop",
        message:
          "This space is not subscribed, so it is back to what a trial allows: " +
          "one worker. Nothing has been deleted.",
      };
    default:
      return null;
  }
}

/** Every status Stripe can send, or null for anything newer than this code. */
export function readStatus(value: unknown): SubscriptionStatus | null {
  const known: SubscriptionStatus[] = [
    "trialing",
    "active",
    "past_due",
    "unpaid",
    "incomplete",
    "incomplete_expired",
    "canceled",
    "paused",
  ];
  return known.find((status) => status === value) ?? null;
}
