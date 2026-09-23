"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { revokeInvite } from "@/lib/invite-actions";
import { announce } from "./ui/announcer";

export interface PendingInvite {
  id: string;
  email: string;
  role: string;
  invitedBy: string;
  /** The teams they land on when they accept, by name. */
  teams: string[];
  /** "in 6 days", already worded by the page. */
  expires: string;
}

/**
 * Invites that are out and not yet used. An invite to a typo, or to someone
 * who has since gone elsewhere, stays valid for a week; this is where it is
 * seen and taken back. Admins only, like inviting.
 */
export function PendingInvites({
  spaceSlug,
  invites,
}: {
  spaceSlug: string;
  invites: PendingInvite[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // A revoked invitation's row goes when the page redraws, and with the last
  // one this whole list. Focus moves then - to this heading while there is a
  // list, to the people above once there is not - rather than before, when
  // the row being removed would take it down with it.
  const revoked = useRef(false);
  useEffect(() => {
    if (!revoked.current) return;
    revoked.current = false;
    (invites.length > 0 ? heading.current : document.getElementById("people"))?.focus();
  }, [invites.length]);

  if (invites.length === 0) return null;

  return (
    <section className="enter-up mt-9">
      <div className="flex items-baseline justify-between gap-4">
        <h2
          ref={heading}
          tabIndex={-1}
          className="text-[13px] font-semibold tracking-[-0.01em] text-ink focus:outline-none"
        >
          Invited, not joined yet
        </h2>
        <p className="hidden text-[12px] text-ink-subtle sm:block">
          A link works for seven days, for that address only
        </p>
      </div>
      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-[var(--radius-edge)] border border-line bg-surface">
        {invites.map((invite) => (
          <li key={invite.id} className="flex items-center gap-3 px-4 py-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-ink">{invite.email}</span>
              <span className="block truncate text-[11.5px] text-ink-subtle">
                As {invite.role === "admin" ? "an admin" : "a member"}
                {invite.teams.length === 0 ? "" : ` on ${invite.teams.join(", ")}`}, by{" "}
                {invite.invitedBy}. Expires {invite.expires}.
              </span>
            </span>
            <button
              type="button"
              aria-disabled={pending || undefined}
              onClick={() => {
                if (pending) return;
                setError(null);
                setBusy(invite.id);
                startTransition(async () => {
                  const result = await revokeInvite(spaceSlug, invite.id);
                  if (!result.ok) setError(result.error);
                  else {
                    // The row goes, and with the last one the whole list: the
                    // words go to the shell, and focus to what is still here.
                    announce(`Revoked the invitation to ${invite.email}`);
                    revoked.current = true;
                    // Off the row before it goes; the list's heading stays.
                    heading.current?.focus();
                  }
                  setBusy(null);
                  router.refresh();
                });
              }}
              className="btn btn-ghost shrink-0 px-2.5 py-1.5 text-[12.5px] hover:text-failed"
            >
              {busy === invite.id ? "Revoking..." : "Revoke"}
              <span className="sr-only"> the invitation to {invite.email}</span>
            </button>
          </li>
        ))}
      </ul>
      {error !== null ? (
        <p role="alert" className="mt-3 text-[12.5px] text-failed">
          {error}
        </p>
      ) : null}
    </section>
  );
}
