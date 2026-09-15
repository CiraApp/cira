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
    <section className="enter-up mt-10">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">Access</h2>
        <p className="text-[12px] text-ink-subtle">
          {hasEveryone ? "Open to the whole space" : "Only the people listed"}
        </p>
      </div>

      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-[var(--radius-edge)] border border-line bg-surface">
        {entries.length === 0 ? (
          <li className="px-4 py-3.5 text-[13px] text-ink-muted">
            Nobody else can open this yet.
          </li>
        ) : (
          entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-sunken/40"
            >
              <span
                aria-hidden="true"
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-edge)] border text-[12px] font-semibold ${
                  entry.kind === "everyone"
                    ? "border-accent/35 bg-accent-quiet text-accent"
                    : "border-line bg-sunken text-ink-muted"
                }`}
              >
                {entry.kind === "everyone" ? "All" : entry.label.charAt(0).toUpperCase()}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-ink">{entry.label}</span>
                {entry.detail !== null ? (
                  <span className="block truncate text-[11.5px] text-ink-subtle">
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
                  className="btn btn-ghost shrink-0 px-2.5 py-1.5 text-[12.5px] hover:text-failed"
                >
                  {busy === entry.id ? "Removing..." : "Remove"}
                </button>
              ) : (
                <span className="shrink-0 px-2.5 text-[11.5px] text-ink-subtle">
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
            className="btn btn-secondary"
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
            className="btn border-dashed border-line-strong text-ink-muted hover:border-accent hover:bg-accent-quiet hover:text-accent"
          >
            {busy === member.userId ? "Adding..." : `+ ${member.name}`}
          </button>
        ))}
      </div>

      {error !== null ? (
        <p role="alert" className="enter-fade mt-3 text-[12.5px] text-failed">
          {error}
        </p>
      ) : null}
    </section>
  );
}
