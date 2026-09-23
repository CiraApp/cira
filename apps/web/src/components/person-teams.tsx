"use client";

import { possessive } from "@cira/core";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTeamMembership } from "@/lib/team-actions";
import { Dialog } from "./ui/dialog";

export interface TeamChoice {
  id: string;
  name: string;
  on: boolean;
}

/**
 * Which teams one person is on, from their own row.
 *
 * The teams panel above answers "who is on Support". This answers the
 * question people actually arrive with, which is the other way round: someone
 * joined, or moved from Support to Engineering, and the thing being held in
 * mind is the person, not the team. Making that a trip through every team in
 * turn is how a roster goes stale.
 *
 * The same server action as the teams panel, ticked one at a time and saved as
 * it is ticked - a team is a roster, not a form.
 */
export function PersonTeams({
  spaceSlug,
  person,
  teams,
  canEdit,
}: {
  spaceSlug: string;
  person: { userId: string; name: string };
  teams: TeamChoice[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const on = teams.filter((team) => team.on);
  const names = on.map((team) => team.name).join(" · ");

  // Nothing to say and nothing to offer: a company with no teams yet is asked
  // to make one in the panel above, not on every person's row.
  if (teams.length === 0) return null;
  if (!canEdit) {
    return on.length === 0 ? null : (
      <span className="mt-0.5 block truncate text-[11.5px] text-ink-subtle">{names}</span>
    );
  }

  // What the box says, not what the props said when this render was made.
  // Asking for a state rather than an inversion is what makes a repeat - a
  // double click, a click while the last one is still in flight, a refresh
  // arriving late - land on the state the person chose instead of undoing it.
  const set = (team: TeamChoice, wanted: boolean) => {
    if (wanted === team.on) return;
    setError(null);
    startTransition(async () => {
      const result = await setTeamMembership(spaceSlug, team.id, person.userId, wanted);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="mt-0.5 block max-w-full truncate text-left text-[11.5px] text-ink-subtle underline decoration-line-strong underline-offset-4 transition-colors duration-150 hover:text-ink-muted hover:decoration-current"
      >
        {on.length === 0 ? "Not on a team" : names}
        <span className="sr-only">
          , change {possessive(person.name, "\u2019")} teams
        </span>
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`${possessive(person.name, "\u2019")} teams`}
        description="What they are on decides which apps open for them, without anyone editing an app."
      >
        <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-[var(--radius-edge)] border border-line bg-surface">
          {teams.map((team) => (
            <li key={team.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3.5 py-2.5 transition-colors duration-150 hover:bg-sunken/40">
                <input
                  type="checkbox"
                  checked={team.on}
                  // Not disabled while saving: that took focus out of the dialog
                  // after every tick. Presses wait instead.
                  aria-disabled={pending || undefined}
                  onChange={(event) => {
                    if (!pending) set(team, event.target.checked);
                  }}
                  className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                  {team.name}
                </span>
              </label>
            </li>
          ))}
        </ul>

        {error !== null ? (
          <p role="alert" className="mt-3 text-[12.5px] text-failed">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end">
          <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost">
            Done
          </button>
        </div>
      </Dialog>
    </>
  );
}
