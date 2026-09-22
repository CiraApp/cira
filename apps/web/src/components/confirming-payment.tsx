"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Shown when someone is back from Stripe's checkout before Stripe has told
 * Cira the payment went through. The page asks again every few seconds, for
 * up to a minute, and becomes the ordinary billing page as soon as it knows.
 */
export function ConfirmingPayment() {
  const router = useRouter();
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (tries >= 20) return;
    const timer = setTimeout(() => {
      router.refresh();
      setTries((n) => n + 1);
    }, 3000);
    return () => clearTimeout(timer);
  }, [tries, router]);

  return (
    <p role="status" className="text-[12.5px] leading-relaxed text-ink-muted">
      {tries < 20
        ? "Payment received. Stripe is confirming it; this updates by itself in a moment."
        : "Stripe has not confirmed the payment yet. It usually does within a few minutes; nothing needs doing again."}
    </p>
  );
}
