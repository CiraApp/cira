"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createInvite, type ActionResult } from "@/lib/invite-actions";
import { CopyableCommand } from "./copyable-command";

/**
 * Inviting is a rare, deliberate act, so it lives behind one button rather
 * than occupying the gallery. The result is a link the inviter sends however
 * they already talk to the person.
 */
export function InviteDialog({ spaceSlug }: { spaceSlug: string }) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const [state, action, pending] = useActionState<
    ActionResult<{ url: string; email: string }> | null,
    FormData
  >(createInvite, null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const inviteUrl =
    state?.ok === true ? `${window.location.origin}${state.data.url}` : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-xl border border-border bg-surface px-3.5 py-2 text-[14px] font-medium text-ink shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:border-border-strong hover:bg-canvas"
      >
        Invite people
      </button>

      {open ? (
        <div
          className="animate-fade-in fixed inset-0 z-50 flex items-start justify-center bg-black/25 px-5 pt-[12vh] backdrop-blur-[2px]"
          onMouseDown={(e) => {
            if (!dialogRef.current?.contains(e.target as Node)) setOpen(false);
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-title"
            className="animate-pop-in w-full max-w-md rounded-2xl border border-border bg-raised p-6 shadow-[var(--shadow-lift)]"
          >
            <h2 id="invite-title" className="text-[17px] font-semibold text-ink">
              Invite to this space
            </h2>

            {inviteUrl === null ? (
              <>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
                  We&rsquo;ll give you a link to send them. Only the address you enter can
                  use it.
                </p>

                <form action={action} className="mt-5 flex flex-col gap-3">
                  <input type="hidden" name="spaceSlug" value={spaceSlug} />

                  <label htmlFor="invite-email" className="sr-only">
                    Email address
                  </label>
                  <input
                    id="invite-email"
                    name="email"
                    type="email"
                    required
                    autoFocus
                    placeholder="colleague@company.com"
                    className="w-full rounded-xl bg-surface px-4 py-2.5 text-[14px] text-ink shadow-[var(--shadow-rest)] outline-none transition-all duration-200 placeholder:text-ink-subtle focus:shadow-[0_0_0_2px_var(--color-accent)]"
                  />

                  <label htmlFor="invite-role" className="sr-only">
                    Role
                  </label>
                  <select
                    id="invite-role"
                    name="role"
                    defaultValue="member"
                    className="w-full rounded-xl bg-surface px-4 py-2.5 text-[14px] text-ink shadow-[var(--shadow-rest)] outline-none transition-all duration-200 focus:shadow-[0_0_0_2px_var(--color-accent)]"
                  >
                    <option value="member">Member - can use apps they are given</option>
                    <option value="admin">Admin - can manage apps and invite</option>
                  </select>

                  {state?.ok === false ? (
                    <p role="alert" className="text-[13px] text-failed">
                      {state.error}
                    </p>
                  ) : null}

                  <div className="mt-1 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="rounded-xl px-3.5 py-2 text-[14px] text-ink-muted transition-colors hover:text-ink"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={pending}
                      className="rounded-xl bg-accent px-4 py-2 text-[14px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
                    >
                      {pending ? "Creating..." : "Create invite"}
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
                  Send this to {state?.ok === true ? state.data.email : "them"}. It works
                  once, for that address only, and lapses in a week.
                </p>

                <div className="mt-5">
                  <CopyableCommand command={inviteUrl} shell={false} />
                </div>

                <div className="mt-5 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-xl bg-accent px-4 py-2 text-[14px] font-medium text-white transition-colors hover:bg-accent-hover"
                  >
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
