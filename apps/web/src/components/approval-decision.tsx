"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideApproval } from "@/lib/approval-actions";

/**
 * The two answers, and what happens after each. An approval runs one call,
 * once, so the page says so plainly: go back to the assistant and tell it to
 * go ahead.
 */
export function ApprovalDecision({
  approvalId,
  status,
  expiresAt,
}: {
  approvalId: string;
  status: "pending" | "approved" | "denied" | "used" | "expired";
  expiresAt: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Set once this person has answered here, so the outcome that replaces the
  // buttons takes focus and is read out. Arriving at an approval that was
  // already settled needs neither.
  const [answered, setAnswered] = useState(false);
  const outcome = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (answered && status !== "pending") outcome.current?.focus();
  }, [answered, status]);

  const answer = (choice: "approve" | "deny") => {
    if (pending) return;
    start(async () => {
      setError(null);
      const result = await decideApproval(approvalId, choice);
      if (!result.ok) setError(result.error);
      else setAnswered(true);
      router.refresh();
    });
  };

  if (status !== "pending") {
    return (
      <p
        ref={outcome}
        tabIndex={-1}
        className="mt-5 text-[13.5px] leading-relaxed text-ink-muted focus:outline-none"
      >
        {SETTLED[status]}
      </p>
    );
  }

  const minutes = Math.max(
    1,
    Math.round((new Date(expiresAt).getTime() - Date.now()) / 60_000),
  );

  return (
    <div className="mt-5 flex flex-col gap-3">
      <div className="flex gap-2">
        <button
          type="button"
          aria-disabled={pending || undefined}
          onClick={() => answer("approve")}
          className="btn btn-primary btn-lg flex-1"
        >
          {pending ? "Saving..." : "Approve"}
        </button>
        <button
          type="button"
          aria-disabled={pending || undefined}
          onClick={() => answer("deny")}
          className="btn btn-secondary btn-lg flex-1"
        >
          Decline
        </button>
      </div>
      <p className="text-[12px] leading-relaxed text-ink-subtle">
        Approving lets it run this once, with exactly what is shown, in the next {minutes}{" "}
        {minutes === 1 ? "minute" : "minutes"}. Then tell your assistant to go ahead.
      </p>
      {error !== null ? (
        <p role="alert" className="text-[12.5px] text-failed">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const SETTLED: Record<"approved" | "denied" | "used" | "expired", string> = {
  approved:
    "Approved. Go back to your assistant and tell it to go ahead; it can run this once.",
  denied: "Declined. Your assistant will be told not to do this.",
  used: "Done. Your assistant has made this change.",
  expired:
    "This request lapsed before it was used. If you still want it, ask your assistant again.",
};
