import { and, asc, count, eq, gt, isNull } from "drizzle-orm";
import { notFound } from "next/navigation";
import {
  apps,
  db,
  inviteTeams,
  invites,
  memberships,
  teamMembers,
  teams,
  users,
} from "@cira/db";
import { roleAtLeast } from "@cira/core";
import { AppShell } from "@/components/shell/app-shell";
import { PageTitle } from "@/components/shell/page-title";
import { InviteDialog } from "@/components/invite-dialog";
import { MemberControls } from "@/components/member-controls";
import { PendingInvites } from "@/components/pending-invites";
import { PersonTeams } from "@/components/person-teams";
import { TeamsPanel } from "@/components/teams-panel";
import { NotFoundError, listMySpaces, requireSpaceMember } from "@/lib/authz";
import { emailConfigured } from "@/lib/email";
import { spaceTitle } from "@/lib/page-title";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ spaceSlug: string }>;
}) {
  return spaceTitle((await params).spaceSlug, "Members");
}

/**
 * Who is here, and how they are grouped.
 *
 * Teams come first because they are what apps are actually given to. Reading
 * the page top to bottom answers "who would this grant reach" before it
 * answers "who works here", which is the question someone on this page is
 * usually holding.
 *
 * Admins change roles, remove people and look after teams here; everyone can
 * leave. The rules are in core and enforced by the actions, not by what this
 * page chooses to show.
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
    const canInvite = roleAtLeast(ctx.role, "admin");
    const database = db();

    const [rows, teamRows, owned, outstanding, invitedTeamRows] = await Promise.all([
      database
        .select({ user: users, role: memberships.role, joined: memberships.createdAt })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.spaceId, ctx.space.id))
        .orderBy(asc(memberships.createdAt)),
      // A left join keeps a team that has not hired anyone yet, which is
      // exactly the team someone is most likely to be looking for.
      database
        .select({ team: teams, userId: teamMembers.userId })
        .from(teams)
        .leftJoin(teamMembers, eq(teamMembers.teamId, teams.id))
        .where(eq(teams.spaceId, ctx.space.id)),
      database
        .select({ ownerUserId: apps.ownerUserId, n: count() })
        .from(apps)
        .where(eq(apps.spaceId, ctx.space.id))
        .groupBy(apps.ownerUserId),
      canInvite
        ? database
            .select({ invite: invites, inviter: users.name })
            .from(invites)
            .innerJoin(users, eq(users.id, invites.invitedByUserId))
            .where(
              and(
                eq(invites.spaceId, ctx.space.id),
                isNull(invites.acceptedAt),
                gt(invites.expiresAt, new Date()),
              ),
            )
            .orderBy(asc(invites.createdAt))
        : Promise.resolve([]),
      // Which teams each outstanding invitation already puts someone on, so
      // the list says what was promised and not only who was asked.
      canInvite
        ? database
            .select({ inviteId: inviteTeams.inviteId, name: teams.name })
            .from(inviteTeams)
            .innerJoin(teams, eq(teams.id, inviteTeams.teamId))
            .where(eq(teams.spaceId, ctx.space.id))
        : Promise.resolve([]),
    ]);

    const invitedOnto = new Map<string, string[]>();
    for (const row of invitedTeamRows) {
      invitedOnto.set(row.inviteId, [...(invitedOnto.get(row.inviteId) ?? []), row.name]);
    }

    const teamList = new Map<
      string,
      { name: string; description: string | null; memberIds: string[] }
    >();
    for (const row of teamRows) {
      const entry = teamList.get(row.team.id) ?? {
        name: row.team.name,
        description: row.team.description,
        memberIds: [],
      };
      if (row.userId !== null) entry.memberIds.push(row.userId);
      teamList.set(row.team.id, entry);
    }
    const teamsByName = [...teamList.entries()]
      .map(([id, team]) => ({ id, ...team }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const teamsFor = new Map<string, string[]>();
    for (const row of teamRows) {
      if (row.userId === null) continue;
      teamsFor.set(row.userId, [...(teamsFor.get(row.userId) ?? []), row.team.id]);
    }

    const appsOwned = new Map(owned.map((o) => [o.ownerUserId, o.n]));

    // Who takes a person's apps if they leave: the longest-standing owner who
    // is not them, which is what `leaveSpace` does.
    const heirFor = (userId: string): string | null =>
      rows.find((r) => r.role === "owner" && r.user.id !== userId)?.user.name ?? null;

    // Owners first, then admins, then everyone alphabetically: the list answers
    // "who do I ask" before it answers "who is here".
    const rank = { owner: 0, admin: 1, member: 2 } as const;
    const people = [...rows].sort(
      (a, b) => rank[a.role] - rank[b.role] || a.user.name.localeCompare(b.user.name),
    );

    return (
      <AppShell
        spaceSlug={spaceSlug}
        spaces={spaces}
        title={
          <PageTitle
            title="Members"
            detail={`${plural(people.length, "person", "people")}${
              teamsByName.length === 0
                ? ""
                : ` across ${plural(teamsByName.length, "team", "teams")}`
            } in ${ctx.space.name}`}
          />
        }
        actions={
          canInvite ? (
            <InviteDialog
              spaceSlug={spaceSlug}
              emailing={emailConfigured()}
              teams={teamsByName.map((team) => ({ id: team.id, name: team.name }))}
            />
          ) : null
        }
      >
        <div className="max-w-[760px]">
          <TeamsPanel
            spaceSlug={spaceSlug}
            canEdit={canInvite}
            teams={teamsByName}
            people={people.map((p) => ({
              userId: p.user.id,
              name: p.user.name,
              email: p.user.email,
            }))}
          />

          <section className="enter-up mt-9">
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
                        {person.user.id === ctx.user.id ? (
                          <span className="ml-1.5 text-[11.5px] font-normal text-ink-subtle">
                            you
                          </span>
                        ) : null}
                      </span>
                      {/* Someone who joined without giving a name is named
                          by their address, which is then already said. */}
                      {person.user.name === person.user.email ? null : (
                        <span className="block truncate text-[12px] text-ink-subtle">
                          {person.user.email}
                        </span>
                      )}
                      <PersonTeams
                        spaceSlug={spaceSlug}
                        canEdit={canInvite}
                        person={{ userId: person.user.id, name: person.user.name }}
                        teams={teamsByName.map((team) => ({
                          id: team.id,
                          name: team.name,
                          on: memberOf.includes(team.id),
                        }))}
                      />
                    </span>

                    <MemberControls
                      spaceSlug={spaceSlug}
                      spaceName={ctx.space.name}
                      person={{
                        userId: person.user.id,
                        name: person.user.name,
                        role: person.role,
                      }}
                      viewer={{
                        userId: ctx.user.id,
                        name: ctx.user.name,
                        role: ctx.role,
                      }}
                      ownedApps={appsOwned.get(person.user.id) ?? 0}
                      heirName={heirFor(person.user.id)}
                    />
                  </li>
                );
              })}
            </ul>
          </section>

          {canInvite ? (
            <PendingInvites
              spaceSlug={spaceSlug}
              invites={outstanding.map(({ invite, inviter }) => ({
                id: invite.id,
                email: invite.email,
                role: invite.role,
                invitedBy: inviter,
                teams: (invitedOnto.get(invite.id) ?? []).sort(),
                expires: inDays(invite.expiresAt),
              }))}
            />
          ) : null}
        </div>
      </AppShell>
    );
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** When an invite stops working, in the words a person would use. */
function inDays(when: Date): string {
  const days = Math.ceil((when.getTime() - Date.now()) / 86_400_000);
  if (days <= 1) return "within a day";
  return `in ${days} days`;
}
