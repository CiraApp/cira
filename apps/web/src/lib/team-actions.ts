"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { appAccess, db, memberships, teamMembers, teams, users } from "@cira/db";
import { newId, roleAtLeast, slugify, slugWithSuffix } from "@cira/core";
import { NotFoundError, requireSpaceMember } from "@/lib/authz";
import { record } from "@/lib/change-record";

/**
 * Teams: what apps are given to, so access follows the roster.
 *
 * Until this existed teams could only be made by the demo seed, so a real
 * company could not use the grant the Access panel leads with. Admins make,
 * rename and delete them and decide who is on each; everyone can see them.
 * Deleting a team takes its grants with it - a grant to a team nobody can see
 * any more would be access nobody can account for.
 */

export type TeamResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

export async function createTeam(
  spaceSlug: string,
  name: string,
  description: string,
): Promise<TeamResult<{ teamId: string }>> {
  const ctx = await adminOf(spaceSlug);
  if (!ctx.ok) return ctx;

  const clean = name.trim();
  const said = description.trim();
  if (clean.length < 2) return { ok: false, error: "Give the team a name." };
  if (clean.length > 60) return { ok: false, error: "That name is too long." };
  if (said.length > 200) return { ok: false, error: "Keep the description short." };

  const database = db();
  const [same] = await database
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.spaceId, ctx.spaceId), eq(teams.name, clean)))
    .limit(1);
  if (same !== undefined)
    return { ok: false, error: `There is already a team called ${clean}.` };

  const slug = await freeTeamSlug(ctx.spaceId, slugify(clean) || "team");
  const teamId = newId("team");
  await database.insert(teams).values({
    id: teamId,
    spaceId: ctx.spaceId,
    name: clean,
    slug,
    description: said === "" ? null : said,
  });

  await record({
    spaceId: ctx.spaceId,
    kind: "team-created",
    actor: ctx.actor,
    actorUserId: ctx.actorUserId,
    subject: clean,
  });

  revalidatePath(`/${spaceSlug}/~/members`);
  return { ok: true, data: { teamId } };
}

export async function renameTeam(
  spaceSlug: string,
  teamId: string,
  name: string,
  description: string,
): Promise<TeamResult> {
  const ctx = await adminOf(spaceSlug);
  if (!ctx.ok) return ctx;

  const clean = name.trim();
  const said = description.trim();
  if (clean.length < 2) return { ok: false, error: "Give the team a name." };
  if (clean.length > 60) return { ok: false, error: "That name is too long." };
  if (said.length > 200) return { ok: false, error: "Keep the description short." };

  const database = db();
  const [same] = await database
    .select({ id: teams.id })
    .from(teams)
    .where(
      and(eq(teams.spaceId, ctx.spaceId), eq(teams.name, clean), ne(teams.id, teamId)),
    )
    .limit(1);
  if (same !== undefined)
    return { ok: false, error: `There is already a team called ${clean}.` };

  const [before] = await database
    .select({ name: teams.name })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.spaceId, ctx.spaceId)))
    .limit(1);

  const updated = await database
    .update(teams)
    .set({ name: clean, description: said === "" ? null : said })
    .where(and(eq(teams.id, teamId), eq(teams.spaceId, ctx.spaceId)))
    .returning({ id: teams.id });
  if (updated.length === 0) return { ok: false, error: "That team is gone." };

  await record({
    spaceId: ctx.spaceId,
    kind: "team-renamed",
    actor: ctx.actor,
    actorUserId: ctx.actorUserId,
    subject: before?.name ?? clean,
    ...(before?.name === clean ? {} : { detail: clean }),
  });

  revalidatePath(`/${spaceSlug}/~/members`);
  return { ok: true, data: null };
}

export async function deleteTeam(spaceSlug: string, teamId: string): Promise<TeamResult> {
  const ctx = await adminOf(spaceSlug);
  if (!ctx.ok) return ctx;

  const database = db();
  const [team] = await database
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.spaceId, ctx.spaceId)))
    .limit(1);
  if (team === undefined) return { ok: false, error: "That team is gone." };

  // Grants name a team by id with no foreign key, so they are removed here
  // rather than left pointing at nothing. Members cascade with the team.
  await database
    .delete(appAccess)
    .where(and(eq(appAccess.type, "team"), eq(appAccess.targetId, teamId)));
  await database.delete(teams).where(eq(teams.id, teamId));

  await record({
    spaceId: ctx.spaceId,
    kind: "team-deleted",
    actor: ctx.actor,
    actorUserId: ctx.actorUserId,
    subject: team.name,
  });

  revalidatePath(`/${spaceSlug}/~/members`);
  return { ok: true, data: null };
}

export async function setTeamMembership(
  spaceSlug: string,
  teamId: string,
  userId: string,
  onTeam: boolean,
): Promise<TeamResult> {
  const ctx = await adminOf(spaceSlug);
  if (!ctx.ok) return ctx;

  const database = db();
  const [team] = await database
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.spaceId, ctx.spaceId)))
    .limit(1);
  if (team === undefined) return { ok: false, error: "That team is gone." };

  const [who] = await database
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!onTeam) {
    await database
      .delete(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));

    await record({
      spaceId: ctx.spaceId,
      kind: "team-membership-changed",
      actor: ctx.actor,
      actorUserId: ctx.actorUserId,
      subject: team.name,
      detail: `${who?.email ?? "someone"} taken out`,
    });

    revalidatePath(`/${spaceSlug}/~/members`);
    return { ok: true, data: null };
  }

  // Only people in this space: a team place for anyone else would be a grant
  // waiting for them to arrive, which is not how anyone expects a team to work.
  const [member] = await database
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.spaceId, ctx.spaceId)))
    .limit(1);
  if (member === undefined)
    return { ok: false, error: "That person is not in this space." };

  await database
    .insert(teamMembers)
    .values({ id: newId("teamMember"), teamId, userId })
    .onConflictDoNothing();

  await record({
    spaceId: ctx.spaceId,
    kind: "team-membership-changed",
    actor: ctx.actor,
    actorUserId: ctx.actorUserId,
    subject: team.name,
    detail: `${who?.email ?? "someone"} put on it`,
  });

  revalidatePath(`/${spaceSlug}/~/members`);
  return { ok: true, data: null };
}

async function freeTeamSlug(spaceId: string, base: string): Promise<string> {
  const database = db();
  for (let attempt = 1; attempt <= 25; attempt += 1) {
    const candidate = attempt === 1 ? base : slugWithSuffix(base, String(attempt));
    const [taken] = await database
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.spaceId, spaceId), eq(teams.slug, candidate)))
      .limit(1);
    if (taken === undefined) return candidate;
  }
  return slugWithSuffix(base, newId("team").slice(-6));
}

async function adminOf(
  spaceSlug: string,
): Promise<
  | { ok: true; spaceId: string; actor: string; actorUserId: string }
  | { ok: false; error: string }
> {
  let ctx;
  try {
    ctx = await requireSpaceMember(spaceSlug);
  } catch (error) {
    if (error instanceof NotFoundError) return { ok: false, error: "No such space." };
    throw error;
  }
  if (!roleAtLeast(ctx.role, "admin")) {
    return { ok: false, error: "Only admins and owners can change teams." };
  }
  return {
    ok: true,
    spaceId: ctx.space.id,
    actor: ctx.user.name,
    actorUserId: ctx.user.id,
  };
}
