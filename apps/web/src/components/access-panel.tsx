"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  grantAccess,
  revokeAccess,
  setAccessLevel,
  type AccessEntry,
  type ImplicitAccess,
  type SpaceMember,
  type SpaceTeam,
} from "@/lib/access-actions";

/** How many people to offer by name before folding the rest away. */
const VISIBLE_CANDIDATES = 8;

/**
 * Who can open this app.
 *
 * Teams are offered before individuals, and deliberately look heavier on the
 * page, because a grant to Support keeps being right after Support hires and a
 * list of eleven names does not. Naming a person is still there for the real
 * exception - one salesperson who needs the finance app - rather than as the
 * path of least resistance.
 *
 * Everything is picked from the space, never typed as an email or an id: a
 * grant to someone outside it would sit in the table doing nothing, and a UI
 * that lets you create one is a UI that invites the mistake.
 */
export function AccessPanel({
  spaceSlug,
  appSlug,
  spaceName,
  entries,
  implicit,
  candidates,
  teamCandidates,
  hasEveryone,
}: {
  spaceSlug: string;
  appSlug: string;
  spaceName: string;
  entries: AccessEntry[];
  implicit: ImplicitAccess;
  candidates: SpaceMember[];
  teamCandidates: SpaceTeam[];
  hasEveryone: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

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

  const always = describeImplicit(implicit);

  // A company of any size turns this row into a wall of names. Enough to pick
  // someone out by sight, and the rest a click away.
  const shown = expanded ? candidates : candidates.slice(0, VISIBLE_CANDIDATES);
  const hidden = candidates.length - shown.length;

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
                  entry.kind === "person"
                    ? "border-line bg-sunken text-ink-muted"
                    : "border-accent/35 bg-accent-quiet text-accent"
                }`}
              >
                {entry.kind === "everyone" ? (
                  "All"
                ) : entry.kind === "team" ? (
                  <TeamGlyph />
                ) : (
                  entry.label.charAt(0).toUpperCase()
                )}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-ink">{entry.label}</span>
                {entry.detail !== null ? (
                  <span className="block truncate text-[11.5px] text-ink-subtle">
                    {entry.detail}
                  </span>
                ) : null}
              </span>

              {entry.kind === "everyone" ? null : (
                <>
                  <label htmlFor={`level-${entry.id}`} className="sr-only">
                    What {entry.label} can do
                  </label>
                  <select
                    id={`level-${entry.id}`}
                    value={entry.level}
                    disabled={pending}
                    onChange={(event) => {
                      const level = event.target.value === "manage" ? "manage" : "use";
                      run(`level-${entry.id}`, () =>
                        setAccessLevel(spaceSlug, appSlug, entry.id, level),
                      );
                    }}
                    title="Managing is deploying it, setting its variables and deciding who sees it"
                    className="field w-auto shrink-0 py-1.5 pr-7 text-[12.5px]"
                  >
                    <option value="use">Can use</option>
                    <option value="manage">Can manage</option>
                  </select>
                </>
              )}

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
            </li>
          ))
        )}

        {always === null ? null : (
          <li
            className="px-4 py-3 text-[12px] leading-relaxed text-ink-subtle"
            title={[implicit.ownerName, ...implicit.adminNames]
              .filter((name) => name !== null)
              .join("\n")}
          >
            {always}
          </li>
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

        {teamCandidates.map((team) => (
          <button
            key={team.teamId}
            type="button"
            disabled={pending}
            onClick={() =>
              run(team.teamId, () =>
                grantAccess(spaceSlug, appSlug, { kind: "team", teamId: team.teamId }),
              )
            }
            title={`${team.size} ${team.size === 1 ? "person" : "people"}`}
            className="btn border-line-strong text-ink-muted hover:border-accent hover:bg-accent-quiet hover:text-accent"
          >
            {busy === team.teamId ? (
              "Adding..."
            ) : (
              <>
                <TeamGlyph />
                {team.name}
              </>
            )}
          </button>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {shown.map((member) => (
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

        {hidden > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="btn btn-ghost text-ink-subtle hover:text-ink"
          >
            {hidden} more
          </button>
        ) : null}
      </div>

      {error !== null ? (
        <p role="alert" className="enter-fade mt-3 text-[12.5px] text-failed">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/**
 * One line for everyone who reaches the app without being granted it.
 *
 * Written out rather than counted alone, because "and 8 admins" is a fact
 * someone reading an access list may want to argue with, and they cannot if
 * they cannot see who.
 */
function describeImplicit({ ownerName, adminNames }: ImplicitAccess): string | null {
  const owner = ownerName === null ? null : `its owner ${ownerName}`;
  const admins =
    adminNames.length === 0
      ? null
      : `${adminNames.length} space ${adminNames.length === 1 ? "admin" : "admins"}: ${adminNames.join(", ")}`;

  const parts = [owner, admins].filter((part) => part !== null);
  if (parts.length === 0) return null;
  return `Always open to ${parts.join(", and to ")}.`;
}

/** Two figures: enough to read as "a group" at 13px, which an avatar is not. */
function TeamGlyph() {
  return (
    <svg
      viewBox="0 0 18 18"
      aria-hidden="true"
      className="h-[13px] w-[13px] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="6.9" cy="6.3" r="2.8" />
      <path d="M2.3 15c0-2.5 2.1-4.2 4.6-4.2s4.6 1.7 4.6 4.2" />
      <path d="M12.2 4.1a2.6 2.6 0 0 1 0 4.8M13.4 10.9c1.4.5 2.4 1.8 2.4 3.5" />
    </svg>
  );
}
