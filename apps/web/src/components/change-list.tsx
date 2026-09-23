"use client";

import { useMemo, useState } from "react";
import { describeChange, type ChangeKind } from "@cira/core";
import { LocalTime } from "./local-time";
import { LiveStatus } from "./ui/live-status";

export interface ChangeRow {
  id: string;
  kind: ChangeKind;
  actor: string;
  subject: string;
  detail: string | null;
  at: string;
}

/**
 * The record of what has been changed about a company, newest first.
 *
 * One sentence a line, because that is how the question arrives: not "which
 * row of which table", but "who made Dana an admin, and when". The search box
 * is there for the way the record is actually used - someone has a name or an
 * app in mind and wants everything about it.
 */
export function ChangeList({ changes }: { changes: ChangeRow[] }) {
  const [query, setQuery] = useState("");

  const lines = useMemo(
    () =>
      changes.map((change) => ({
        ...change,
        sentence: describeChange(change),
      })),
    [changes],
  );

  const needle = query.trim().toLowerCase();
  const shown =
    needle === ""
      ? lines
      : lines.filter((l) => l.sentence.toLowerCase().includes(needle));

  if (changes.length === 0) {
    return (
      <p className="mt-4 rounded-[var(--radius-edge)] border border-line bg-surface px-4 py-4 text-[12.5px] text-ink-muted">
        Nothing has been changed yet. Roles, access, teams, agent permissions, addresses
        and sign-in all appear here as they are changed.
      </p>
    );
  }

  return (
    <>
      <label
        role="search"
        className="mt-4 flex flex-col gap-1.5 text-[12px] text-ink-subtle"
      >
        Search the record
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by person, app or team"
          spellCheck={false}
          className="field w-full py-2.5 text-[13px]"
        />
      </label>
      {/* The list changes under the cursor with every letter; this says by how
          much, once typing settles into a result. */}
      <LiveStatus
        message={
          needle === ""
            ? null
            : shown.length === 0
              ? "Nothing matches"
              : `${shown.length} ${shown.length === 1 ? "change matches" : "changes match"}`
        }
      />

      {shown.length === 0 ? (
        <p className="mt-3 rounded-[var(--radius-edge)] border border-line bg-surface px-4 py-4 text-[12.5px] text-ink-muted">
          Nothing in the record matches that.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line overflow-hidden rounded-[var(--radius-edge)] border border-line bg-surface">
          {shown.map((line) => (
            <li
              key={line.id}
              className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-3"
            >
              <span className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-ink">
                {line.sentence}
              </span>
              <span className="tabular shrink-0 text-[11.5px] text-ink-subtle">
                <LocalTime at={line.at} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
