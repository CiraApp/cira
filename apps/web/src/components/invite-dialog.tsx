"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  createInvite,
  type ActionResult,
  type CreatedInvite,
} from "@/lib/invite-actions";
import { CopyableCommand } from "./copyable-command";
import { Dialog } from "./ui/dialog";

/**
 * Inviting is a rare, deliberate act, so it lives behind one button rather
 * than occupying the gallery. The invitation is emailed when this Cira can
 * send email, and the link is shown either way, for the inviter to send
 * however they already talk to the person.
 */
export function InviteDialog({
  spaceSlug,
  emailing,
  teams,
  openOnArrival = false,
}: {
  spaceSlug: string;
  /** Whether invitations go out by email here, so the dialog promises only that. */
  emailing: boolean;
  /** The company's teams, to put someone on one before they ever sign in. */
  teams: Array<{ id: string; name: string }>;
  /**
   * Open straight away: the new space's "Invite your team" arrives here, and
   * a button promising an invitation should not end on a page where the
   * next thing is to find a second button saying the same.
   */
  openOnArrival?: boolean;
}) {
  const [open, setOpen] = useState(openOnArrival);

  // Opened once for having arrived, not every time the address is revisited.
  useEffect(() => {
    if (!openOnArrival) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("invite");
    window.history.replaceState(window.history.state, "", url);
  }, [openOnArrival]);

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

      <Dialog open={open} onClose={() => setOpen(false)} title="Invite to this space">
        {/* Mounted only while open, so each opening starts from an empty
            form rather than showing the last invitation's link again. */}
        <InviteForm
          spaceSlug={spaceSlug}
          emailing={emailing}
          teams={teams}
          onDone={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}

function InviteForm({
  spaceSlug,
  emailing,
  teams,
  onDone,
}: {
  spaceSlug: string;
  emailing: boolean;
  teams: Array<{ id: string; name: string }>;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<
    ActionResult<CreatedInvite> | null,
    FormData
  >(createInvite, null);
  const outcome = useRef<HTMLParagraphElement>(null);

  const inviteUrl =
    state?.ok === true ? `${window.location.origin}${state.data.url}` : null;

  // The form, and the button that was pressed, are gone once the invitation
  // exists. Focus goes to what replaced them, so it is read out rather than
  // left somewhere that no longer is.
  useEffect(() => {
    if (inviteUrl !== null) outcome.current?.focus();
  }, [inviteUrl]);

  if (inviteUrl !== null && state?.ok === true) {
    return (
      <>
        <p
          ref={outcome}
          tabIndex={-1}
          className="text-[12.5px] leading-relaxed text-ink-muted focus:outline-none"
        >
          {state.data.emailed
            ? `Invitation sent to ${state.data.email}. It works once, for that address only, and lapses in a week. If it does not arrive, send them this link yourself.`
            : `Send this to ${state.data.email}. It works once, for that address only, and lapses in a week.`}
        </p>

        <div className="mt-5">
          <CopyableCommand command={inviteUrl} shell={false} />
        </div>

        <div className="mt-5 flex justify-end">
          <button type="button" onClick={onDone} className="btn btn-primary">
            Done
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      {/* Pulled up under the title, where the dialog's own description sits:
          it belongs to the form, and goes when the form does. */}
      <p className="-mt-3.5 text-[12.5px] leading-relaxed text-ink-muted">
        {emailing
          ? "We’ll email them an invitation. Only the address you enter can accept it."
          : "We’ll give you a link to send them. Only the address you enter can use it."}
      </p>

      <form action={action} className="mt-5 flex flex-col gap-3">
        <input type="hidden" name="spaceSlug" value={spaceSlug} />

        <label className="flex flex-col gap-1.5 text-[12px] text-ink-subtle">
          Their email address
          <input
            id="invite-email"
            name="email"
            type="email"
            required
            autoComplete="off"
            data-autofocus
            placeholder="colleague@company.com"
            className="field py-2.5 text-[13.5px] text-ink"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-[12px] text-ink-subtle">
          What they can do
          <select
            id="invite-role"
            name="role"
            defaultValue="member"
            className="field py-2.5 text-[13.5px] text-ink"
          >
            <option value="member">Member - can use apps they are given</option>
            <option value="admin">Admin - can manage apps and invite</option>
          </select>
        </label>

        {/* Chosen here rather than after they arrive, because the first day is
            exactly when nobody goes back to a roster: they accept and the
            apps their team opens are open. */}
        {teams.length > 0 ? (
          <fieldset>
            <legend className="mb-1.5 text-[12px] text-ink-subtle">
              Teams they start on
            </legend>
            <div className="flex max-h-40 flex-col divide-y divide-line overflow-y-auto rounded-[var(--radius-edge)] border border-line bg-surface">
              {teams.map((team) => (
                <label
                  key={team.id}
                  className="flex cursor-pointer items-center gap-3 px-3.5 py-2.5 text-[13px] text-ink transition-colors duration-150 hover:bg-sunken/40"
                >
                  <input
                    type="checkbox"
                    name="teams"
                    value={team.id}
                    className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                  />
                  <span className="min-w-0 truncate">{team.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        {state?.ok === false ? (
          <p role="alert" className="text-[12.5px] text-failed">
            {state.error}
          </p>
        ) : null}

        <div className="mt-1 flex justify-end gap-2">
          <button type="button" onClick={onDone} className="btn btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={pending} className="btn btn-primary">
            {emailing
              ? pending
                ? "Sending..."
                : "Send invite"
              : pending
                ? "Creating..."
                : "Create invite"}
          </button>
        </div>
      </form>
    </>
  );
}
