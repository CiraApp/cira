"use server";

import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, memberships, users } from "@cira/db";
import { checkRemoval, checkRoleChange, ROLES } from "@cira/core";
import type { Role } from "@cira/core";
import { NotFoundError, requireSpaceMember } from "@/lib/authz";
import { record } from "@/lib/change-record";
import { depart } from "@/lib/departure";

/**
 * Changing who is in a space: roles, removing someone, and leaving.
 *
 * Until this existed nobody could be taken out of a company at all. Someone
 * who left kept their membership, their role, their apps and every grant,
 * and their CLI and assistant tokens kept working, because all of those are
 * checked against membership - which is exactly why removing it is enough to
 * stop them, and why it has to be done carefully.
 *
 * The rules are `checkRoleChange` and `checkRemoval` in core. What this adds
 * is what has to happen to what a person leaves behind, all in one act: their
 * apps get a new owner, their grants and team places go, and joining by
 * domain cannot bring them straight back.
 */

export type MemberResult = { ok: true } | { ok: false; error: string };

export async function changeRole(
  spaceSlug: string,
  userId: string,
  role: Role,
): Promise<MemberResult> {
  if (!ROLES.includes(role)) return { ok: false, error: "That is not a role." };

  const found = await load(spaceSlug, userId);
  if (!found.ok) return found;
  const { ctx, target, owners } = found;

  const verdict = checkRoleChange({
    actorRole: ctx.role,
    targetRole: target.role,
    nextRole: role,
    owners,
    self: target.userId === ctx.user.id,
  });
  if (!verdict.ok) return { ok: false, error: verdict.reason };

  await db()
    .update(memberships)
    .set({ role })
    .where(eq(memberships.id, target.membershipId));

  await record({
    spaceId: ctx.space.id,
    kind: "role-changed",
    actor: ctx.user.name,
    actorUserId: ctx.user.id,
    subject: target.email,
    detail: `${target.role} to ${role}`,
  });

  revalidatePath(`/${spaceSlug}/~/members`);
  return { ok: true };
}

/** Take someone out of the space. Their apps become the remover's. */
export async function removeMember(
  spaceSlug: string,
  userId: string,
): Promise<MemberResult> {
  const found = await load(spaceSlug, userId);
  if (!found.ok) return found;
  const { ctx, target, owners } = found;

  if (target.userId === ctx.user.id) {
    return { ok: false, error: "To take yourself out, leave the space instead." };
  }

  const verdict = checkRemoval({
    actorRole: ctx.role,
    targetRole: target.role,
    owners,
    self: false,
  });
  if (!verdict.ok) return { ok: false, error: verdict.reason };

  await depart({
    spaceId: ctx.space.id,
    membershipId: target.membershipId,
    userId: target.userId,
    email: target.email,
    heir: ctx.user.id,
    blockRejoin: true,
  });

  await record({
    spaceId: ctx.space.id,
    kind: "member-removed",
    actor: ctx.user.name,
    actorUserId: ctx.user.id,
    subject: target.email,
  });

  revalidatePath(`/${spaceSlug}/~/members`);
  return { ok: true };
}

/**
 * Leave a space. Their apps go to its longest-standing owner, who is who a
 * company would ask about them.
 */
export async function leaveSpace(spaceSlug: string): Promise<MemberResult> {
  let ctx;
  try {
    ctx = await requireSpaceMember(spaceSlug);
  } catch (error) {
    if (error instanceof NotFoundError)
      return { ok: false, error: "That space is gone." };
    throw error;
  }

  const everyone = await roster(ctx.space.id);
  const owners = everyone.filter((m) => m.role === "owner");
  const verdict = checkRemoval({
    actorRole: ctx.role,
    targetRole: ctx.role,
    owners: owners.length,
    self: true,
  });
  if (!verdict.ok) return { ok: false, error: verdict.reason };

  const me = everyone.find((m) => m.userId === ctx.user.id);
  const heir = owners.find((m) => m.userId !== ctx.user.id);
  if (me === undefined) return { ok: false, error: "You are not in this space." };
  if (heir === undefined) {
    // Only possible if the space somehow has no owner but the one leaving,
    // which the rule above already refuses.
    return { ok: false, error: "Make someone else an owner before you leave." };
  }

  await depart({
    spaceId: ctx.space.id,
    membershipId: me.membershipId,
    userId: ctx.user.id,
    email: ctx.user.email,
    heir: heir.userId,
    // Leaving is their own choice; nothing stops them being invited back, and
    // nothing needs to stop them coming back by domain either.
    blockRejoin: false,
  });

  await record({
    spaceId: ctx.space.id,
    kind: "member-left",
    actor: ctx.user.name,
    subject: ctx.user.email,
  });

  return { ok: true };
}

interface RosterEntry {
  membershipId: string;
  userId: string;
  email: string;
  role: Role;
}

async function roster(spaceId: string): Promise<RosterEntry[]> {
  const rows = await db()
    .select({
      membershipId: memberships.id,
      userId: memberships.userId,
      email: users.email,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.spaceId, spaceId))
    .orderBy(asc(memberships.createdAt));
  return rows;
}

async function load(
  spaceSlug: string,
  userId: string,
): Promise<
  | {
      ok: true;
      ctx: Awaited<ReturnType<typeof requireSpaceMember>>;
      target: RosterEntry;
      owners: number;
    }
  | { ok: false; error: string }
> {
  let ctx;
  try {
    ctx = await requireSpaceMember(spaceSlug);
  } catch (error) {
    if (error instanceof NotFoundError)
      return { ok: false, error: "That space is gone." };
    throw error;
  }
  const everyone = await roster(ctx.space.id);
  const target = everyone.find((m) => m.userId === userId);
  if (target === undefined) {
    return { ok: false, error: "That person is no longer in this space." };
  }
  return {
    ok: true,
    ctx,
    target,
    owners: everyone.filter((m) => m.role === "owner").length,
  };
}
