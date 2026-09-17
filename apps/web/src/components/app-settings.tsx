"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteApp, updateAppDetails } from "@/lib/app-settings-actions";

/**
 * Settings sit behind a disclosure because they are rare and one of them is
 * destructive. Nothing here should be a thing you click on the way past.
 *
 * The name and description used to live here and now live at the top of the
 * page, where they are read - which is where somebody notices they are wrong.
 * Leaving a copy behind would have been two forms for one field, able to
 * disagree about what is in it.
 */
export function AppSettings({
  spaceSlug,
  appSlug,
  appName,
  appHomepageUrl,
}: {
  spaceSlug: string;
  appSlug: string;
  /** Only for the delete confirmation; renaming happens at the top of the page. */
  appName: string;
  appHomepageUrl: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState(false);
  const panel = useRef<HTMLDetailsElement>(null);

  // Opened by a link from elsewhere on the page, because the one setting here
  // that someone arrives looking for - where this app really opens - is the
  // one they are sent to rather than the one they go hunting for.
  //
  // On the hash changing as well as on mount. The link is on this same page,
  // so following it never remounts anything: checking only once would leave
  // the panel shut for exactly the person who was sent here to open it.
  useEffect(() => {
    const reveal = () => {
      if (window.location.hash !== "#settings") return;
      const element = panel.current;
      if (element === null) return;
      element.open = true;

      // To the field itself, not to the panel that contains it. Opening the
      // panel puts its heading at the top of the screen and leaves Homepage
      // below the fold under Name and Description - which is the same hunt the
      // link existed to save. Focused as well as scrolled to, so the cursor is
      // already where the answer goes.
      const field = element.querySelector<HTMLInputElement>("#app-homepage");
      const target = field ?? element;
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      field?.focus({ preventScroll: true });
    };

    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, []);

  const save = (formData: FormData) => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateAppDetails(spaceSlug, appSlug, formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  };

  const remove = () => {
    setError(null);
    startTransition(async () => {
      const result = await deleteApp(spaceSlug, appSlug, confirmName);
      if (result.ok) router.replace(`/${spaceSlug}`);
      else setError(result.error);
    });
  };

  return (
    <details id="settings" ref={panel} className="group mt-10 scroll-mt-6">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-[12.5px] text-ink-muted transition-colors duration-150 hover:text-ink">
        <svg
          viewBox="0 0 12 12"
          aria-hidden="true"
          className="h-3 w-3 transition-transform duration-300 ease-[var(--ease-spring)] group-open:rotate-90"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m4.5 2.5 3.5 3.5-3.5 3.5" />
        </svg>
        Settings
      </summary>

      <div className="enter-up mt-4 flex flex-col gap-6 rounded-[var(--radius-edge)] border border-line bg-surface p-5">
        <form action={save} className="flex flex-col gap-2">
          <label htmlFor="app-homepage" className="text-[12.5px] font-medium text-ink">
            Homepage
          </label>
          <p className="text-[11.5px] leading-relaxed text-ink-subtle">
            Where Open should send people, if the interface they use lives somewhere Cira
            does not host. Empty means Cira opens the app it serves.
          </p>
          <input
            id="app-homepage"
            name="homepageUrl"
            type="url"
            inputMode="url"
            defaultValue={appHomepageUrl ?? ""}
            placeholder="https://wav3.space"
            className="field mt-1"
          />

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="submit" disabled={pending} className="btn btn-secondary">
              {pending ? "Saving..." : "Save"}
            </button>
            {saved && !pending ? (
              <span className="enter-fade text-[11.5px] text-live">Saved</span>
            ) : null}
          </div>
        </form>

        <div className="border-t border-line pt-5">
          <p className="text-[12.5px] font-medium text-ink">Delete this app</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-subtle">
            Takes the running app down and removes it from {spaceSlug}. Its deploy history
            goes with it. This cannot be undone.
          </p>

          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="btn btn-secondary mt-3 text-failed hover:border-failed hover:bg-failed/5 hover:text-failed"
            >
              Delete
            </button>
          ) : (
            <div className="enter-fade mt-3 flex flex-col gap-2">
              <label htmlFor="confirm" className="text-[11.5px] text-ink-muted">
                Type <span className="font-medium text-ink">{appName}</span> to confirm.
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  id="confirm"
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  autoFocus
                  placeholder={appName}
                  className="field field-danger flex-1"
                />
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="btn btn-ghost"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={remove}
                  disabled={pending || confirmName.trim() !== appName.trim()}
                  className="btn btn-danger"
                >
                  {pending ? "Deleting..." : "Delete for good"}
                </button>
              </div>
            </div>
          )}
        </div>

        {error !== null ? (
          <p role="alert" className="text-[12.5px] text-failed">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}
