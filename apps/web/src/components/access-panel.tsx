"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  grantAccess,
  revokeAccess,
  type AccessEntry,
  type SpaceMember,
} from "@/lib/access-actions";

/**
 * Who can open this app.
 *
 * People are picked from the space, never typed as an email: a grant to
 * someone outside the space would sit in the table doing nothing, and a UI
 * that lets you create one is a UI that invites the mistake.
 */
export function AccessPanel({
  spaceSlug,
  appSlug,
  spaceName,
  entries,
  candidates,
  hasEveryone,
}: {
  spaceSlug: string;
  appSlug: string;
  spaceName: string;
  entries: AccessEntry[];
  candidates: SpaceMember[];
  hasEveryone: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const run = (key: string, work: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    setBusy(key);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) setError(result.error ?? "That did not work.");
      setBusy(null);
      router.refresh();
    });
  };

  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-[15px] font-semibold text-ink">Access</h2>
        <p className="text-[13px] text-ink-muted">
          {hasEveryone ? "Open to the whole space" : "Only the people listed"}
        </p>
      </div>

      <ul className="mt-3 divide-y divide-border overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-rest)]">
        {entries.length === 0 ? (
          <li className="px-5 py-4 text-[14px] text-ink-muted">
            Nobody else can open this yet.
          </li>
        ) : (
          entries.map((entry) => (
            <li key={entry.id} className="flex items-center gap-3 px-5 py-3.5">
              <span
                aria-hidden="true"
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${
                  entry.kind === "everyone"
                    ? "bg-accent-soft text-accent"
                    : "bg-canvas text-ink-muted"
                }`}
              >
                {entry.kind === "everyone" ? "All" : entry.label.charAt(0).toUpperCase()}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] text-ink">{entry.label}</span>
                {entry.detail !== null ? (
                  <span className="block truncate text-[12px] text-ink-subtle">
                    {entry.detail}
                  </span>
                ) : null}
              </span>

              {entry.removable ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run(entry.id, () => revokeAccess(spaceSlug, appSlug, entry.id))
                  }
                  className="shrink-0 rounded-lg px-2.5 py-1.5 text-[13px] text-ink-muted transition-colors hover:bg-canvas hover:text-failed disabled:opacity-50"
                >
                  {busy === entry.id ? "Removing..." : "Remove"}
                </button>
              ) : (
                <span className="shrink-0 px-2.5 text-[12px] text-ink-subtle">
                  Always
                </span>
              )}
            </li>
          ))
        )}
      </ul>

      <div className="mt-3 flex flex-wrap gap-2">
        {!hasEveryone ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run("everyone", () => grantAccess(spaceSlug, appSlug, { kind: "everyone" }))
            }
            className="rounded-xl border border-border bg-surface px-3.5 py-2 text-[13px] font-medium text-ink transition-colors hover:border-border-strong hover:bg-canvas disabled:opacity-50"
          >
            {busy === "everyone" ? "Adding..." : `Give everyone at ${spaceName} access`}
          </button>
        ) : null}

        {candidates.map((member) => (
          <button
            key={member.userId}
            type="button"
            disabled={pending}
            onClick={() =>
              run(member.userId, () =>
                grantAccess(spaceSlug, appSlug, {
                  kind: "person",
                  userId: member.userId,
                }),
              )
            }
            title={member.email}
            className="rounded-xl border border-dashed border-border-strong px-3.5 py-2 text-[13px] text-ink-muted transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent disabled:opacity-50"
          >
            {busy === member.userId ? "Adding..." : `+ ${member.name}`}
          </button>
        ))}
      </div>

      {error !== null ? (
        <p role="alert" className="mt-3 text-[13px] text-failed">
          {error}
        </p>
      ) : null}
    </section>
  );
}
