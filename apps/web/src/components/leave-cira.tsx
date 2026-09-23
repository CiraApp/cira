"use client";

import { useRef, useState, useTransition } from "react";
import { deleteSpace } from "@/lib/space-actions";

/**
 * Leaving: the file of everything Cira holds, and the way out.
 *
 * The export is offered first and by itself, because a company that is
 * deciding whether to stay should be able to read what Cira knows without
 * going anywhere near the delete button. The delete asks for the space's name
 * typed back, the way an app's does, and says plainly what goes with it.
 */
export function LeaveCira({
  spaceSlug,
  spaceName,
  apps,
  canDelete,
}: {
  spaceSlug: string;
  spaceName: string;
  /** How many apps will be taken down, said before it happens. */
  apps: number;
  /** Only an owner may; everyone else sees the export alone. */
  canDelete: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const deleteButton = useRef<HTMLButtonElement>(null);

  const cancel = () => {
    setConfirming(false);
    setTyped("");
    // Back to the button that opened this, once it is drawn again.
    requestAnimationFrame(() => deleteButton.current?.focus());
  };

  return (
    <section className="mt-8 max-w-[620px] border-t border-line pt-5">
      <h2 className="text-[12.5px] font-medium text-ink">Leaving Cira</h2>
      <p className="mt-1 text-[11.5px] leading-relaxed text-ink-subtle">
        Take everything Cira holds about {spaceName} with you: who is in it, what each app
        is, and how it runs. Not your apps&rsquo; own data, and not the values of their
        environment variables, which Cira never stores.
      </p>

      <a href={`/${spaceSlug}/~/export`} className="btn btn-secondary mt-3" download>
        Export everything
      </a>

      {canDelete ? (
        <div className="mt-6">
          <h3 className="text-[12.5px] font-medium text-ink">Delete this space</h3>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-subtle">
            Takes down {apps === 0 ? "everything it runs" : `its ${apps} `}
            {apps === 1 ? "app" : apps > 1 ? "apps" : ""} and removes the space, its
            people, its teams and its history. This cannot be undone.
          </p>

          {!confirming ? (
            <button
              ref={deleteButton}
              type="button"
              onClick={() => setConfirming(true)}
              className="btn btn-secondary mt-3 text-failed hover:border-failed hover:bg-failed/5 hover:text-failed"
            >
              Delete<span className="sr-only"> {spaceName}</span>
            </button>
          ) : (
            <div className="enter-fade mt-3 flex flex-col gap-2">
              <label htmlFor="confirm-space" className="text-[11.5px] text-ink-muted">
                Type <span className="font-medium text-ink">{spaceName}</span> to confirm.
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  id="confirm-space"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") cancel();
                  }}
                  autoFocus
                  placeholder={spaceName}
                  className="field field-danger flex-1"
                />
                <button type="button" onClick={cancel} className="btn btn-ghost">
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={typed.trim() !== spaceName.trim()}
                  aria-disabled={pending || undefined}
                  onClick={() => {
                    if (pending) return;
                    start(async () => {
                      setError(null);
                      // Only ever returns on refusal; success redirects away.
                      const result = await deleteSpace(spaceSlug, typed);
                      setError(result.error);
                    });
                  }}
                  className="btn btn-danger"
                >
                  {pending ? "Deleting..." : "Delete for good"}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {error !== null ? (
        <p role="alert" className="enter-fade mt-3 text-[12.5px] text-failed">
          {error}
        </p>
      ) : null}
    </section>
  );
}
