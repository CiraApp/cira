"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createInvite, type ActionResult } from "@/lib/invite-actions";
import { CopyableCommand } from "./copyable-command";
import { Portal } from "./ui/portal";

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
      {/* Label and all on a laptop; on a phone the header has a hamburger, a
          search, a theme switch and an avatar to fit, and a rare action does
          not get to push the page title out of the room. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Invite people"
        className="btn btn-secondary h-[30px] px-2 sm:px-3"
      >
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="6.4" cy="5.6" r="2.6" />
          <path d="M1.9 13.4c0-2.3 2-3.8 4.5-3.8s4.5 1.5 4.5 3.8" />
          <path d="M12.6 4.6v3.6M14.4 6.4h-3.6" />
        </svg>
        <span className="hidden sm:inline">Invite people</span>
      </button>

      {open ? (
        <Portal>
          <div
            className="enter-fade fixed inset-0 z-50 flex items-start justify-center bg-sunken/70 px-5 pt-[12vh] backdrop-blur-[3px]"
            onMouseDown={(e) => {
              if (!dialogRef.current?.contains(e.target as Node)) setOpen(false);
            }}
          >
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="invite-title"
              className="enter-pop w-full max-w-md rounded-[var(--radius-edge)] border border-line-strong bg-raised p-6 shadow-[var(--shadow-panel)]"
            >
              <h2
                id="invite-title"
                className="text-[15px] font-semibold tracking-[-0.01em] text-ink"
              >
                Invite to this space
              </h2>

              {inviteUrl === null ? (
                <>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-muted">
                    We&rsquo;ll give you a link to send them. Only the address you enter
                    can use it.
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
                      className="field py-2.5 text-[13.5px]"
                    />

                    <label htmlFor="invite-role" className="sr-only">
                      Role
                    </label>
                    <select
                      id="invite-role"
                      name="role"
                      defaultValue="member"
                      className="field py-2.5 text-[13.5px]"
                    >
                      <option value="member">Member - can use apps they are given</option>
                      <option value="admin">Admin - can manage apps and invite</option>
                    </select>

                    {state?.ok === false ? (
                      <p role="alert" className="text-[12.5px] text-failed">
                        {state.error}
                      </p>
                    ) : null}

                    <div className="mt-1 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setOpen(false)}
                        className="btn btn-ghost"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={pending}
                        className="btn btn-primary"
                      >
                        {pending ? "Creating..." : "Create invite"}
                      </button>
                    </div>
                  </form>
                </>
              ) : (
                <>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-muted">
                    Send this to {state?.ok === true ? state.data.email : "them"}. It
                    works once, for that address only, and lapses in a week.
                  </p>

                  <div className="mt-5">
                    <CopyableCommand command={inviteUrl} shell={false} />
                  </div>

                  <div className="mt-5 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="btn btn-primary"
                    >
                      Done
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </Portal>
      ) : null}
    </>
  );
}
