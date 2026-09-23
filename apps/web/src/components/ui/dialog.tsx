"use client";

import { useEffect, useId, useRef } from "react";

/**
 * A panel over the page, for a decision that deserves one: removing someone,
 * editing a team. Escape or a click outside closes it.
 *
 * The browser's own modal `<dialog>`, rather than a positioned div. That is
 * what makes it a dialog for everyone, not only for people using a mouse:
 * focus moves into it when it opens, Tab cannot wander out to the dimmed page
 * behind (which the browser makes inert), and when it closes focus goes back
 * to whatever opened it. The hand-built version did none of that - a keyboard
 * user pressing Enter on "New team" stayed on the button behind the overlay.
 *
 * It sits in the browser's top layer, which also takes it out from under the
 * header's backdrop filter; that is what the old Portal was for.
 *
 * Focus lands on the first control inside, or on one marked
 * `data-autofocus` - which a confirmation should put on its safe choice, so
 * that one Enter does not remove a colleague.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  width = "max-w-md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  width?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) {
      element.showModal();
      element.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      // Escape: let the page's own state close it, so the two never disagree.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // Closed by the browser anyway (a second Escape can be forced through):
      // the page has to hear about it, or it would think the dialog still open.
      onClose={() => {
        if (open) onClose();
      }}
      // A click on the backdrop lands on the dialog itself; the content fills
      // it, so a click inside never does.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className={`enter-pop mx-auto mt-[12vh] w-[calc(100%-2.5rem)] ${width} rounded-[var(--radius-edge)] border border-line-strong bg-raised p-0 text-ink shadow-[var(--shadow-panel)] backdrop:bg-sunken/70 backdrop:backdrop-blur-[3px]`}
    >
      {open ? (
        <div className="p-6">
          <h2
            id={titleId}
            className="text-[15px] font-semibold tracking-[-0.01em] text-ink"
          >
            {title}
          </h2>
          {description === undefined ? null : (
            <div
              id={descriptionId}
              className="mt-1.5 text-[12.5px] leading-relaxed text-ink-muted"
            >
              {description}
            </div>
          )}
          <div className="mt-5">{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}
