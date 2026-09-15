"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteApp, renameApp } from "@/lib/app-settings-actions";

/**
 * Settings sit behind a disclosure because they are rare and one of them is
 * destructive. Nothing here should be a thing you click on the way past.
 */
export function AppSettings({
  spaceSlug,
  appSlug,
  appName,
}: {
  spaceSlug: string;
  appSlug: string;
  appName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [confirming, setConfirming] = useState(false);

  const rename = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const result = await renameApp(spaceSlug, appSlug, formData);
      if (result.ok) router.replace(`/${spaceSlug}/${result.data.appSlug}`);
      else setError(result.error);
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
    <details className="group mt-10">
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
        <form action={rename} className="flex flex-col gap-2">
          <label htmlFor="app-name" className="text-[12.5px] font-medium text-ink">
            Name
          </label>
          <p className="text-[11.5px] leading-relaxed text-ink-subtle">
            Renaming changes this app&rsquo;s address, so existing links to it will stop
            working.
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            <input
              id="app-name"
              name="name"
              defaultValue={appName}
              className="field flex-1"
            />
            <button type="submit" disabled={pending} className="btn btn-secondary">
              Rename
            </button>
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
