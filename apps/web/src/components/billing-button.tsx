"use client";

import { useState, useTransition } from "react";
import { openBilling, startCheckout } from "@/lib/billing-actions";

/**
 * The one button that leads to money: to Stripe's checkout while a space is
 * not paying, and to Stripe's own billing page while it is. Both are hosted
 * by Stripe, so nothing about a card is typed into Cira.
 *
 * "Not paying" includes a space that once started a checkout and left, or
 * cancelled: it used to be offered only the billing page, which cannot start a
 * subscription, so it could never pay again. Such a space still gets a way to
 * its past invoices.
 */
export function BillingButton({
  spaceSlug,
  subscribed,
  customer = false,
}: {
  spaceSlug: string;
  subscribed: boolean;
  /** Whether Stripe knows this company, so it has invoices to look back at. */
  customer?: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        aria-disabled={pending || undefined}
        onClick={() => {
          if (pending) return;
          start(async () => {
            setError(null);
            const outcome = subscribed
              ? await openBilling(spaceSlug)
              : await startCheckout(spaceSlug);
            if (outcome.ok) window.location.assign(outcome.url);
            else setError(outcome.error);
          });
        }}
        className={subscribed ? "btn btn-secondary" : "btn btn-primary"}
      >
        {pending
          ? "Opening Stripe..."
          : subscribed
            ? "Manage billing"
            : "Subscribe to Team"}
      </button>
      {!subscribed && customer ? (
        <button
          type="button"
          aria-disabled={pending || undefined}
          onClick={() => {
            if (pending) return;
            start(async () => {
              setError(null);
              const outcome = await openBilling(spaceSlug);
              if (outcome.ok) window.location.assign(outcome.url);
              else setError(outcome.error);
            });
          }}
          className="btn btn-ghost"
        >
          Past invoices
        </button>
      ) : null}
      {error !== null ? (
        <span role="alert" className="text-[12px] text-failed">
          {error}
        </span>
      ) : null}
    </span>
  );
}
