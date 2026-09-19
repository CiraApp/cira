import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, memberships, teamMembers, teams, users } from "@cira/db";
import { AppShell } from "@/components/shell/app-shell";
import { PageTitle } from "@/components/shell/page-title";
import { InviteDialog } from "@/components/invite-dialog";
import { NotFoundError, listMySpaces, requireSpaceMember } from "@/lib/authz";
import { emailConfigured } from "@/lib/email";

const ROLE_NOTE: Record<string, string> = {
  owner: "Full control of this space",
  admin: "Can manage apps and invite people",
  member: "Can use the apps they are given",
};

/**
 * Who is here, and how they are grouped.
 *
 * Teams come first because they are what apps are actually given to. Reading
 * the page top to bottom answers "who would this grant reach" before it
 * answers "who works here", which is the question someone on this page is
 * usually holding.
 */
export default async function MembersPage({
  params,
}: {
  params: Promise<{ spaceSlug: string }>;
}) {
  const { spaceSlug } = await params;

  try {
    const ctx = await requireSpaceMember(spaceSlug);
    const spaces = await listMySpaces();
    const canInvite = ctx.role === "admin" || ctx.role === "owner";

    const rows = await db()
      .select({ user: users, role: memberships.role, joined: memberships.createdAt })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.spaceId, ctx.space.id));

    // One query for the whole grouping. A left join keeps a team that has not
    // hired anyone yet, which is exactly the team someone is most likely to be
    // looking for.
    const teamRows = await db()
      .select({ team: teams, userId: teamMembers.userId })
      .from(teams)
      .leftJoin(teamMembers, eq(teamMembers.teamId, teams.id))
      .where(eq(teams.spaceId, ctx.space.id));

    const byName = new Map(rows.map((r) => [r.user.id, r.user.name]));

    const teamList = new Map<
      string,
      { name: string; description: string | null; members: string[] }
    >();
    for (const row of teamRows) {
      const entry = teamList.get(row.team.id) ?? {
        name: row.team.name,
        description: row.team.description,
        members: [],
      };
      const name = row.userId === null ? undefined : byName.get(row.userId);
      if (name !== undefined) entry.members.push(name);
      teamList.set(row.team.id, entry);
    }

    const teamsByName = [...teamList.entries()]
      .map(([id, team]) => ({ id, ...team, members: team.members.sort() }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const teamsFor = new Map<string, string[]>();
    for (const row of teamRows) {
      if (row.userId === null) continue;
      teamsFor.set(row.userId, [...(teamsFor.get(row.userId) ?? []), row.team.name]);
    }

    // Owners first, then admins, then everyone alphabetically: the list answers
    // "who do I ask" before it answers "who is here".
    const rank = { owner: 0, admin: 1, member: 2 } as const;
    const people = rows.sort(
      (a, b) => rank[a.role] - rank[b.role] || a.user.name.localeCompare(b.user.name),
    );

    return (
      <AppShell
        spaceSlug={spaceSlug}
        spaces={spaces}
        title={
          <PageTitle
            title="Members"
            detail={`${count(people.length, "person", "people")}${
              teamsByName.length === 0
                ? ""
                : ` across ${count(teamsByName.length, "team", "teams")}`
            } in ${ctx.space.name}`}
          />
        }
        actions={
          canInvite ? (
            <InviteDialog spaceSlug={spaceSlug} emailing={emailConfigured()} />
          ) : null
        }
      >
        <div className="max-w-[760px]">
          {teamsByName.length > 0 ? (
            <section className="enter-up">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">
                  Teams
                </h2>
                <p className="hidden text-[12px] text-ink-subtle sm:block">
                  What apps are given to, so access follows the roster
                </p>
              </div>

              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {teamsByName.map((team) => (
                  <li
                    key={team.id}
                    className="rounded-[var(--radius-edge)] border border-line bg-surface p-3.5 transition-colors duration-150 hover:border-line-strong"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="min-w-0 truncate text-[13px] font-medium text-ink">
                        {team.name}
                      </h3>
                      <span className="tabular shrink-0 text-[11.5px] text-ink-subtle">
                        {team.members.length}
                      </span>
                    </div>

                    {team.description !== null ? (
                      <p className="mt-1 text-[12px] leading-relaxed text-ink-subtle">
                        {team.description}
                      </p>
                    ) : null}

                    <p className="mt-2 truncate text-[11.5px] text-ink-muted">
                      {team.members.length === 0 ? "Nobody yet" : team.members.join(", ")}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className={teamsByName.length > 0 ? "enter-up mt-9" : "enter-up"}>
            <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">
              People
            </h2>

            <ul className="mt-3 divide-y divide-line overflow-hidden rounded-[var(--radius-edge)] border border-line bg-surface">
              {people.map((person) => {
                const memberOf = teamsFor.get(person.user.id) ?? [];

                return (
                  <li
                    key={person.user.id}
                    className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-sunken/50"
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-edge)] border border-line bg-sunken text-[12px] font-semibold text-ink-muted"
                    >
                      {person.user.name.charAt(0).toUpperCase()}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">
                        {person.user.name}
                      </span>
                      <span className="block truncate text-[12px] text-ink-subtle">
                        {person.user.email}
                      </span>
                      {memberOf.length > 0 ? (
                        <span className="mt-0.5 block truncate text-[11.5px] text-ink-subtle">
                          {memberOf.sort().join(" · ")}
                        </span>
                      ) : null}
                    </span>

                    <span className="hidden text-right sm:block">
                      <span className="block text-[12px] font-medium text-ink capitalize">
                        {person.role}
                      </span>
                      <span className="block text-[11px] text-ink-subtle">
                        {ROLE_NOTE[person.role]}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </AppShell>
    );
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
