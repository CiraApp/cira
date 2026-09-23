"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createTeam,
  deleteTeam,
  renameTeam,
  setTeamMembership,
} from "@/lib/team-actions";
import { Dialog } from "./ui/dialog";
import { LiveStatus } from "./ui/live-status";

export interface TeamView {
  id: string;
  name: string;
  description: string | null;
  memberIds: string[];
}

export interface PersonView {
  userId: string;
  name: string;
  email: string;
}

/**
 * Teams, first on the members page because they are what apps are given to.
 *
 * Everyone sees who is on each; admins make them, rename them, choose who is
 * on them and delete them. Membership is ticked in place, one person at a
 * time, and saved as it is ticked: a team is a roster people change one hire
 * at a time, not a form filled in once.
 */
export function TeamsPanel({
  spaceSlug,
  canEdit,
  teams,
  people,
}: {
  spaceSlug: string;
  canEdit: boolean;
  teams: TeamView[];
  people: PersonView[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const newTeam = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const byId = new Map(people.map((p) => [p.userId, p]));
  const current =
    editing === null || editing === "new" ? null : teams.find((t) => t.id === editing);

  const open = (team: TeamView | "new") => {
    setError(null);
    setSaid(null);
    setConfirmDelete(false);
    setEditing(team === "new" ? "new" : team.id);
    setName(team === "new" ? "" : team.name);
    setDescription(team === "new" ? "" : (team.description ?? ""));
  };

  const run = (
    work: () => Promise<{ ok: boolean; error?: string }>,
    done: string,
    close = false,
  ) => {
    if (pending) return;
    setError(null);
    setSaid(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        setError(result.error ?? "That did not work.");
        return;
      }
      setSaid(done);
      if (close) {
        setEditing(null);
        // The card that opened the dialog is gone with the team, so there is
        // nothing for the browser to hand focus back to.
        requestAnimationFrame(() => (newTeam.current ?? heading.current)?.focus());
      }
      router.refresh();
    });
  };

  if (teams.length === 0 && !canEdit) return null;

  return (
    <section className="enter-up">
      <div className="flex items-baseline justify-between gap-4">
        <h2
          ref={heading}
          tabIndex={-1}
          className="text-[13px] font-semibold tracking-[-0.01em] text-ink focus:outline-none"
        >
          Teams
        </h2>
        {canEdit ? (
          <button
            ref={newTeam}
            type="button"
            onClick={() => open("new")}
            className="btn btn-ghost px-2.5 py-1.5 text-[12.5px]"
          >
            New team
          </button>
        ) : (
          <p className="hidden text-[12px] text-ink-subtle sm:block">
            What apps are given to, so access follows the roster
          </p>
        )}
      </div>

      {teams.length === 0 ? (
        <p className="mt-3 rounded-[var(--radius-edge)] border border-dashed border-line-strong px-4 py-3.5 text-[12.5px] leading-relaxed text-ink-muted">
          No teams yet. A team is what you give an app to, so when someone joins or moves,
          their access follows without anyone editing an app.
        </p>
      ) : (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {teams.map((team) => {
            const names = team.memberIds
              .map((id) => byId.get(id)?.name)
              .filter((n): n is string => n !== undefined)
              .sort();
            const size = (
              <span className="sr-only">
                , {names.length} {names.length === 1 ? "person" : "people"}
              </span>
            );
            return (
              // The whole card opens the team for an admin, but the button is
              // the name inside the heading, stretched over the card: a
              // button cannot hold a heading and paragraphs, and wrapping them
              // in one had them read as one long label with no heading to
              // find the team by.
              <li
                key={team.id}
                className={`relative rounded-[var(--radius-edge)] border border-line bg-surface p-3.5 transition-colors duration-150 ${
                  canEdit ? "focus-within:border-accent hover:border-line-strong" : ""
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="min-w-0 truncate text-[13px] font-medium text-ink">
                    {canEdit ? (
                      <button
                        type="button"
                        onClick={() => open(team)}
                        className="text-left after:absolute after:inset-0 after:rounded-[var(--radius-edge)] focus-visible:outline-none"
                      >
                        {team.name}
                        {size}
                      </button>
                    ) : (
                      <>
                        {team.name}
                        {size}
                      </>
                    )}
                  </h3>
                  <span
                    aria-hidden="true"
                    className="tabular shrink-0 text-[11.5px] text-ink-subtle"
                  >
                    {names.length}
                  </span>
                </div>
                {team.description !== null ? (
                  <p className="mt-1 text-[12px] leading-relaxed text-ink-subtle">
                    {team.description}
                  </p>
                ) : null}
                <p className="mt-2 truncate text-[11.5px] text-ink-muted">
                  {names.length === 0 ? "Nobody yet" : names.join(", ")}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={editing !== null}
        onClose={() => {
          setEditing(null);
          setSaid(null);
        }}
        title={editing === "new" ? "New team" : (current?.name ?? "Team")}
        width="max-w-lg"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (pending) return;
            if (editing === "new") {
              // Straight on to choosing who is on it, which is the point of
              // making one.
              setError(null);
              setSaid(null);
              startTransition(async () => {
                const result = await createTeam(spaceSlug, name, description);
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                setEditing(result.data.teamId);
                setSaid(`Made ${name.trim()}. Choose who is on it.`);
                router.refresh();
              });
            } else if (current !== null && current !== undefined) {
              run(() => renameTeam(spaceSlug, current.id, name, description), "Saved");
            }
          }}
          className="flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1.5 text-[12px] text-ink-subtle">
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Support"
              maxLength={60}
              className="field py-2.5 text-[13.5px]"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[12px] text-ink-subtle">
            What it is for, if it helps
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Everyone who answers customers"
              maxLength={200}
              className="field py-2.5 text-[13.5px]"
            />
          </label>
          <div className="flex justify-end gap-2">
            {editing === "new" ? (
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="btn btn-ghost"
              >
                Cancel
              </button>
            ) : null}
            <button
              type="submit"
              aria-disabled={pending || undefined}
              className="btn btn-secondary"
            >
              {editing === "new"
                ? pending
                  ? "Creating..."
                  : "Create team"
                : pending
                  ? "Saving..."
                  : "Save name"}
            </button>
          </div>
        </form>

        {current !== null && current !== undefined ? (
          <>
            <h3 className="mt-6 text-[12px] font-medium text-ink">Who is on it</h3>
            <ul className="mt-2 max-h-64 divide-y divide-line overflow-y-auto rounded-[var(--radius-edge)] border border-line bg-surface">
              {people.map((person) => {
                const on = current.memberIds.includes(person.userId);
                return (
                  <li key={person.userId}>
                    <label className="flex cursor-pointer items-center gap-3 px-3.5 py-2.5 transition-colors duration-150 hover:bg-sunken/40">
                      <input
                        type="checkbox"
                        checked={on}
                        // Not disabled while saving: that took focus out of the
                        // dialog after every tick. Presses wait instead.
                        aria-disabled={pending || undefined}
                        onChange={(event) => {
                          if (pending) return;
                          const wanted = event.target.checked;
                          if (wanted === on) return;
                          run(
                            () =>
                              setTeamMembership(
                                spaceSlug,
                                current.id,
                                person.userId,
                                wanted,
                              ),
                            wanted
                              ? `Added ${person.name} to ${current.name}`
                              : `Took ${person.name} off ${current.name}`,
                          );
                        }}
                        className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-ink">
                          {person.name}
                        </span>
                        <span className="block truncate text-[11.5px] text-ink-subtle">
                          {person.email}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            <div className="mt-5 flex items-center justify-between gap-3">
              {confirmDelete ? (
                <span className="flex items-center gap-2 text-[12.5px] text-ink-muted">
                  Its access to apps goes with it.
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="btn btn-ghost px-2.5 py-1.5 text-[12.5px]"
                  >
                    Keep it
                  </button>
                  <button
                    type="button"
                    // Moves focus here from the button this replaced, which
                    // would otherwise drop it out of the dialog.
                    autoFocus
                    aria-disabled={pending || undefined}
                    onClick={() =>
                      run(
                        () => deleteTeam(spaceSlug, current.id),
                        `Deleted ${current.name}`,
                        true,
                      )
                    }
                    className="btn btn-danger px-2.5 py-1.5 text-[12.5px]"
                  >
                    {pending ? "Deleting..." : "Delete team"}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="btn btn-ghost px-2.5 py-1.5 text-[12.5px] hover:text-failed"
                >
                  Delete team
                </button>
              )}
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="btn btn-ghost"
              >
                Done
              </button>
            </div>
          </>
        ) : null}

        {error !== null ? (
          <p role="alert" className="mt-3 text-[12.5px] text-failed">
            {error}
          </p>
        ) : null}
        <LiveStatus message={said} />
      </Dialog>
      {/* Out here too, for what is said as the dialog closes. */}
      <LiveStatus message={editing === null ? said : null} />
    </section>
  );
}
