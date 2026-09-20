"use client";

import { useState, useTransition } from "react";
import { openBilling, startCheckout } from "@/lib/billing-actions";

/**
 * The one button that leads to money: to Stripe's checkout while a space is
 * on a trial, and to Stripe's own billing page once it pays. Both are hosted
 * by Stripe, so nothing about a card is typed into Cira.
 */
export function BillingButton({
  spaceSlug,
  subscribed,
}: {
  spaceSlug: string;
  subscribed: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const outcome = subscribed
              ? await openBilling(spaceSlug)
              : await startCheckout(spaceSlug);
            if (outcome.ok) window.location.assign(outcome.url);
            else setError(outcome.error);
          })
        }
        className={subscribed ? "btn btn-secondary" : "btn btn-primary"}
      >
        {pending
          ? "Opening Stripe..."
          : subscribed
            ? "Manage billing"
            : "Subscribe to Team"}
      </button>
      {error !== null ? (
        <span role="alert" className="text-[12px] text-failed">
          {error}
        </span>
      ) : null}
    </span>
  );
}
