"use server";

import { and, eq } from "drizzle-orm";
import { appAccess, db, memberships, teamMembers, teams, users } from "@cira/db";
import { newId } from "@cira/core";
import type { AccessLevel, Role } from "@cira/core";
import { ForbiddenError, NotFoundError, requireAppManage } from "@/lib/authz";
import { record } from "@/lib/change-record";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface SpaceMember {
  userId: string;
  name: string;
  email: string;
  role: Role;
}

export interface SpaceTeam {
  teamId: string;
  name: string;
  /** How many people the grant would reach today. */
  size: number;
}

export interface AccessEntry {
  id: string;
  kind: "everyone" | "team" | "person";
  /** For a person: their name. For a team: its name. For everyone: the space. */
  label: string;
  detail: string | null;
  /** Open only, or also deploy and configure. Always `use` for everyone. */
  level: AccessLevel;
}

/**
 * The people who reach this app without a grant: its owner, and every admin.
 *
 * Summarised rather than listed as rows. In a company with eight admins,
 * listing them turns the access panel into a page of entries nobody can act
 * on and pushes the two grants that were actually made off the screen - which
 * is the opposite of what someone opened this panel to see. Saying it in a
 * line still stops anyone "fixing" an absence by adding a grant that changes
 * nothing.
 */
export interface ImplicitAccess {
  ownerName: string | null;
  adminNames: string[];
}

/**
 * Who can open this app, and who could be given it.
 *
 * Only people already in the space are offered: a grant to anyone else is
 * dead on arrival, because membership is checked before any grant is
 * consulted. Offering an email box here would invite exactly that mistake.
 */
export async function loadAccess(
  spaceSlug: string,
  appSlug: string,
): Promise<{
  entries: AccessEntry[];
  implicit: ImplicitAccess;
  candidates: SpaceMember[];
  teamCandidates: SpaceTeam[];
}> {
  const ctx = await requireAppManage(spaceSlug, appSlug);
  const database = db();

  const memberRows = await database
    .select({ user: users, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.spaceId, ctx.space.id));

  const grants = await database
    .select()
    .from(appAccess)
    .where(eq(appAccess.appId, ctx.app.id));

  const teamRows = await database
    .select({ team: teams, userId: teamMembers.userId })
    .from(teams)
    .leftJoin(teamMembers, eq(teamMembers.teamId, teams.id))
    .where(eq(teams.spaceId, ctx.space.id));

  const teamSizes = new Map<string, { name: string; size: number }>();
  for (const row of teamRows) {
    const seen = teamSizes.get(row.team.id) ?? { name: row.team.name, size: 0 };
    teamSizes.set(row.team.id, {
      name: row.team.name,
      size: seen.size + (row.userId === null ? 0 : 1),
    });
  }

  const byId = new Map(memberRows.map((m) => [m.user.id, m]));
  const entries: AccessEntry[] = [];

  for (const grant of grants) {
    if (grant.type === "space") {
      entries.push({
        id: grant.id,
        kind: "everyone",
        label: `Everyone at ${ctx.space.name}`,
        detail: people(memberRows.length),
        level: "use",
      });
      continue;
    }

    if (grant.type === "team") {
      const team = teamSizes.get(grant.targetId);
      entries.push({
        id: grant.id,
        kind: "team",
        label: team?.name ?? "A team that no longer exists",
        detail: team === undefined ? "Nobody" : people(team.size),
        level: grant.level,
      });
      continue;
    }

    const member = byId.get(grant.targetId);
    entries.push({
      id: grant.id,
      kind: "person",
      label: member?.user.name ?? "Someone no longer in this space",
      detail: member?.user.email ?? null,
      level: grant.level,
    });
  }

  const implicit: ImplicitAccess = {
    ownerName:
      memberRows.find((m) => m.user.id === ctx.app.ownerUserId)?.user.name ?? null,
    adminNames: memberRows
      .filter((m) => m.role !== "member" && m.user.id !== ctx.app.ownerUserId)
      .map((m) => m.user.name)
      .sort((a, b) => a.localeCompare(b)),
  };

  const granted = new Set(grants.filter((g) => g.type === "user").map((g) => g.targetId));

  const candidates = memberRows
    .filter((m) => !granted.has(m.user.id))
    .filter((m) => m.user.id !== ctx.app.ownerUserId && m.role === "member")
    .map((m) => ({
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const grantedTeams = new Set(
    grants.filter((g) => g.type === "team").map((g) => g.targetId),
  );

  const teamCandidates = [...teamSizes.entries()]
    .filter(([id]) => !grantedTeams.has(id))
    .map(([teamId, team]) => ({ teamId, name: team.name, size: team.size }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { entries, implicit, candidates, teamCandidates };
}

function people(count: number): string {
  return `${count} ${count === 1 ? "person" : "people"}`;
}

/** Grant one person, one team, or everyone in the space, access to an app. */
export async function grantAccess(
  spaceSlug: string,
  appSlug: string,
  target:
    | { kind: "everyone" }
    | { kind: "team"; teamId: string }
    | { kind: "person"; userId: string },
): Promise<ActionResult<null>> {
  try {
    const ctx = await requireAppManage(spaceSlug, appSlug);
    const database = db();

    if (target.kind === "everyone") {
      await database
        .insert(appAccess)
        .values({
          id: newId("access"),
          appId: ctx.app.id,
          type: "space",
          targetId: ctx.space.id,
        })
        .onConflictDoNothing();
      await record({
        spaceId: ctx.space.id,
        kind: "access-granted",
        actor: ctx.user.name,
        actorUserId: ctx.user.id,
        subject: "everyone in the company",
        appId: ctx.app.id,
        detail: ctx.app.name,
      });
      return { ok: true, data: null };
    }

    if (target.kind === "team") {
      // Same rule as a person: the team has to belong to this space, or the
      // grant names something the access check will never look at.
      const [team] = await database
        .select({ id: teams.id, name: teams.name })
        .from(teams)
        .where(and(eq(teams.id, target.teamId), eq(teams.spaceId, ctx.space.id)))
        .limit(1);

      if (team === undefined) {
        return { ok: false, error: "That team is not in this space." };
      }

      await database
        .insert(appAccess)
        .values({
          id: newId("access"),
          appId: ctx.app.id,
          type: "team",
          targetId: target.teamId,
        })
        .onConflictDoNothing();

      await record({
        spaceId: ctx.space.id,
        kind: "access-granted",
        actor: ctx.user.name,
        actorUserId: ctx.user.id,
        subject: team.name,
        appId: ctx.app.id,
        detail: ctx.app.name,
      });
      return { ok: true, data: null };
    }

    // The person must already be in this space. Without this check a grant
    // could name anyone, and would sit in the table doing nothing.
    const [member] = await database
      .select({ id: memberships.id, email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(eq(memberships.userId, target.userId), eq(memberships.spaceId, ctx.space.id)),
      )
      .limit(1);

    if (member === undefined) {
      return { ok: false, error: "That person is not in this space." };
    }

    await database
      .insert(appAccess)
      .values({
        id: newId("access"),
        appId: ctx.app.id,
        type: "user",
        targetId: target.userId,
      })
      .onConflictDoNothing();

    await record({
      spaceId: ctx.space.id,
      kind: "access-granted",
      actor: ctx.user.name,
      actorUserId: ctx.user.id,
      subject: member.email,
      appId: ctx.app.id,
      detail: ctx.app.name,
    });
    return { ok: true, data: null };
  } catch (error) {
    return asActionError(error);
  }
}

/**
 * Let a person or a team manage this app as well as open it, or take that
 * back. Managing is deploying it, setting its variables and deciding who else
 * sees it, so it is never given to the whole space: "everyone may redeploy
 * payroll" is not a setting anyone should be one click away from.
 */
export async function setAccessLevel(
  spaceSlug: string,
  appSlug: string,
  grantId: string,
  level: AccessLevel,
): Promise<ActionResult<null>> {
  try {
    const ctx = await requireAppManage(spaceSlug, appSlug);
    if (level !== "use" && level !== "manage") {
      return { ok: false, error: "That is not a level of access." };
    }
    const database = db();

    const [grant] = await database
      .select({ type: appAccess.type, targetId: appAccess.targetId })
      .from(appAccess)
      .where(and(eq(appAccess.id, grantId), eq(appAccess.appId, ctx.app.id)))
      .limit(1);
    if (grant === undefined) return { ok: false, error: "That access was removed." };
    if (grant.type === "space" && level === "manage") {
      return {
        ok: false,
        error: "Managing an app is given to people or teams, never to everyone at once.",
      };
    }

    await database
      .update(appAccess)
      .set({ level })
      .where(and(eq(appAccess.id, grantId), eq(appAccess.appId, ctx.app.id)));

    await record({
      spaceId: ctx.space.id,
      kind: "access-level-changed",
      actor: ctx.user.name,
      actorUserId: ctx.user.id,
      subject: await granteeName(grant, ctx.space.id),
      appId: ctx.app.id,
      detail:
        level === "manage"
          ? `managing ${ctx.app.name}`
          : `opening ${ctx.app.name}, no longer managing it`,
    });
    return { ok: true, data: null };
  } catch (error) {
    return asActionError(error);
  }
}

export async function revokeAccess(
  spaceSlug: string,
  appSlug: string,
  grantId: string,
): Promise<ActionResult<null>> {
  try {
    const ctx = await requireAppManage(spaceSlug, appSlug);

    // Scoped to this app, so a grant id from elsewhere cannot be removed.
    const [gone] = await db()
      .delete(appAccess)
      .where(and(eq(appAccess.id, grantId), eq(appAccess.appId, ctx.app.id)))
      .returning({ type: appAccess.type, targetId: appAccess.targetId });

    if (gone !== undefined) {
      await record({
        spaceId: ctx.space.id,
        kind: "access-revoked",
        actor: ctx.user.name,
        actorUserId: ctx.user.id,
        subject: await granteeName(gone, ctx.space.id),
        appId: ctx.app.id,
        detail: ctx.app.name,
      });
    }

    return { ok: true, data: null };
  } catch (error) {
    return asActionError(error);
  }
}

/**
 * Who a grant is for, in the words the record keeps: a person's address, a
 * team's name, or everyone. Read before the record is written, because the
 * grant may be the thing that has just gone.
 */
async function granteeName(
  grant: { type: string; targetId: string },
  spaceId: string,
): Promise<string> {
  if (grant.type === "space") return "everyone in the company";
  if (grant.type === "team") {
    const [team] = await db()
      .select({ name: teams.name })
      .from(teams)
      .where(and(eq(teams.id, grant.targetId), eq(teams.spaceId, spaceId)))
      .limit(1);
    return team?.name ?? "a team that is gone";
  }
  const [person] = await db()
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, grant.targetId))
    .limit(1);
  return person?.email ?? "someone who is gone";
}

function asActionError(error: unknown): ActionResult<never> {
  if (error instanceof ForbiddenError) {
    return { ok: false, error: "You do not have permission to change access here." };
  }
  if (error instanceof NotFoundError) {
    return { ok: false, error: "That app no longer exists." };
  }
  throw error;
}
