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
      <summary className="cursor-pointer list-none text-[13px] text-ink-muted transition-colors hover:text-ink">
        Settings
      </summary>

      <div className="mt-4 flex flex-col gap-6 rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-rest)] p-5">
        <form action={rename} className="flex flex-col gap-2">
          <label htmlFor="app-name" className="text-[13px] font-medium text-ink">
            Name
          </label>
          <p className="text-[12px] text-ink-subtle">
            Renaming changes this app&rsquo;s address, so existing links to it will stop
            working.
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            <input
              id="app-name"
              name="name"
              defaultValue={appName}
              className="min-w-0 flex-1 rounded-xl bg-sunken px-3.5 py-2 text-[14px] text-ink outline-none transition-all duration-200 focus:shadow-[0_0_0_2px_var(--color-accent)]"
            />
            <button
              type="submit"
              disabled={pending}
              className="rounded-xl border border-border bg-surface px-3.5 py-2 text-[13px] font-medium text-ink transition-colors hover:border-border-strong hover:bg-canvas disabled:opacity-50"
            >
              Rename
            </button>
          </div>
        </form>

        <div className="border-t border-border pt-5">
          <p className="text-[13px] font-medium text-ink">Delete this app</p>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-subtle">
            Takes the running app down and removes it from {spaceSlug}. Its deploy history
            goes with it. This cannot be undone.
          </p>

          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="mt-3 rounded-xl border border-border px-3.5 py-2 text-[13px] font-medium text-failed transition-colors hover:border-failed hover:bg-failed/5"
            >
              Delete
            </button>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              <label htmlFor="confirm" className="text-[12px] text-ink-muted">
                Type <span className="font-medium text-ink">{appName}</span> to confirm.
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  id="confirm"
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  autoFocus
                  placeholder={appName}
                  className="min-w-0 flex-1 rounded-xl bg-sunken px-3.5 py-2 text-[14px] text-ink outline-none transition-all duration-200 placeholder:text-ink-subtle focus:shadow-[0_0_0_2px_var(--color-failed)]"
                />
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded-xl px-3 py-2 text-[13px] text-ink-muted transition-colors hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={remove}
                  disabled={pending || confirmName.trim() !== appName.trim()}
                  className="rounded-xl bg-failed px-3.5 py-2 text-[13px] font-medium text-white transition-colors disabled:opacity-40"
                >
                  {pending ? "Deleting..." : "Delete for good"}
                </button>
              </div>
            </div>
          )}
        </div>

        {error !== null ? (
          <p role="alert" className="text-[13px] text-failed">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}
