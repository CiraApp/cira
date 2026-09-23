"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  atomically,
  db,
  inviteTeams,
  invites,
  memberships,
  spaceJoinBlocks,
  spaces,
  teamMembers,
  teams,
  users,
} from "@cira/db";
import { isInviteToken, newId, newInviteToken } from "@cira/core";
import { hashToken } from "@/lib/token-hash";
import type { Role } from "@cira/core";
import { requireCurrentUser } from "@/lib/identity";
import { ForbiddenError, requireInviteRights } from "@/lib/authz";
import { record } from "@/lib/change-record";
import { checkInvite, inviteExpiry } from "@/lib/invite-rules";
import { appOrigin, sendEmail } from "@/lib/email";
import { inviteMessage } from "@/lib/messages";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const createInput = z.object({
  spaceSlug: z.string(),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("That does not look like an email address."),
  role: z.enum(["member", "admin"]),
  /** The teams they land on when they accept. Any that are not this space's
      are dropped rather than refused: the invitation is the point. */
  teamIds: z.array(z.string()).max(50).default([]),
});

export interface CreatedInvite {
  url: string;
  email: string;
  /** Whether the invitation went out by email; the link works either way. */
  emailed: boolean;
}

/**
 * Invite someone to a space: email them the link, and hand it to the inviter
 * too, since an email can land in spam and a link can be sent another way.
 * The invite names one address, so the link cannot be forwarded into the
 * space by someone else.
 */
export async function createInvite(
  _previous: ActionResult<CreatedInvite> | null,
  formData: FormData,
): Promise<ActionResult<CreatedInvite>> {
  const parsed = createInput.safeParse({
    spaceSlug: formData.get("spaceSlug"),
    email: formData.get("email"),
    role: formData.get("role") ?? "member",
    teamIds: formData.getAll("teams").map(String),
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the details and try again.",
    };
  }

  const { spaceSlug, email, role, teamIds } = parsed.data;

  let ctx;
  try {
    ctx = await requireInviteRights(spaceSlug);
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "You do not have permission to invite people here." };
    }
    throw error;
  }

  const database = db();

  // Already a member: say so rather than issuing an invite that does nothing.
  const [existingUser] = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existingUser !== undefined) {
    const [already] = await database
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, existingUser.id),
          eq(memberships.spaceId, ctx.space.id),
        ),
      )
      .limit(1);

    if (already !== undefined) {
      return { ok: false, error: `${email} is already in ${ctx.space.name}.` };
    }
  }

  // Re-inviting replaces the outstanding invite rather than stacking another,
  // so only the newest link ever works.
  await database
    .delete(invites)
    .where(
      and(
        eq(invites.spaceId, ctx.space.id),
        eq(invites.email, email),
        isNull(invites.acceptedAt),
      ),
    );

  // Only this space's teams, read here rather than trusted from the form: the
  // browser sends ids, not a right to put someone on another company's team.
  const chosen =
    teamIds.length === 0
      ? []
      : await database
          .select({ id: teams.id, name: teams.name })
          .from(teams)
          .where(and(eq(teams.spaceId, ctx.space.id), inArray(teams.id, teamIds)));

  const token = newInviteToken();
  const expiresAt = inviteExpiry();
  const inviteId = newId("invite");
  await database.insert(invites).values({
    id: inviteId,
    spaceId: ctx.space.id,
    email,
    role: role as Role,
    // The link is sent and returned once, below, and only its hash is kept.
    tokenHash: hashToken(token),
    invitedByUserId: ctx.user.id,
    expiresAt,
  });
  if (chosen.length > 0) {
    await database
      .insert(inviteTeams)
      .values(
        chosen.map((team) => ({
          id: newId("inviteTeam"),
          inviteId,
          teamId: team.id,
        })),
      )
      .onConflictDoNothing();
  }

  const path = `/invite/${token}`;
  const sent = await sendEmail({
    to: email,
    ...inviteMessage({
      inviter: ctx.user.name,
      spaceName: ctx.space.name,
      role,
      email,
      url: `${appOrigin()}${path}`,
      expiresAt,
      teams: chosen.map((team) => team.name),
    }),
  });

  await record({
    spaceId: ctx.space.id,
    kind: "invite-sent",
    actor: ctx.user.name,
    actorUserId: ctx.user.id,
    subject: email,
    detail:
      chosen.length === 0
        ? role
        : `${role}, on ${chosen.map((team) => team.name).join(", ")}`,
  });

  return { ok: true, data: { url: path, email, emailed: sent.sent } };
}

export async function revokeInvite(
  spaceSlug: string,
  inviteId: string,
): Promise<ActionResult<null>> {
  try {
    const ctx = await requireInviteRights(spaceSlug);
    const [gone] = await db()
      .delete(invites)
      .where(and(eq(invites.id, inviteId), eq(invites.spaceId, ctx.space.id)))
      .returning({ email: invites.email });
    if (gone !== undefined) {
      await record({
        spaceId: ctx.space.id,
        kind: "invite-revoked",
        actor: ctx.user.name,
        actorUserId: ctx.user.id,
        subject: gone.email,
      });
    }
    return { ok: true, data: null };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "You do not have permission to do that." };
    }
    throw error;
  }
}

export type AcceptResult =
  { ok: true; spaceSlug: string; spaceName: string } | { ok: false; error: string };

/** Accept an invite as the signed-in person. */
export async function acceptInvite(token: string): Promise<AcceptResult> {
  if (!isInviteToken(token))
    return { ok: false, error: "This invite link is not valid." };

  const user = await requireCurrentUser();
  const database = db();

  const [row] = await database
    .select({ invite: invites, space: spaces })
    .from(invites)
    .innerJoin(spaces, eq(invites.spaceId, spaces.id))
    .where(eq(invites.tokenHash, hashToken(token)))
    .limit(1);

  if (row === undefined) return { ok: false, error: "This invite link is not valid." };

  const verdict = checkInvite({
    invite: row.invite,
    viewerEmail: user.email,
    now: new Date(),
  });
  if (!verdict.ok) return { ok: false, error: verdict.message };

  // Joining twice is success, not an error: the person ends up where they meant to be.
  const [already] = await database
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), eq(memberships.spaceId, row.space.id)))
    .limit(1);

  // The teams the invitation carries, read now: a team deleted while the
  // invitation sat in someone's inbox took its row with it, so what is here is
  // what still exists.
  const joining = await database
    .select({ id: teams.id, name: teams.name })
    .from(inviteTeams)
    .innerJoin(teams, eq(teams.id, inviteTeams.teamId))
    .where(eq(inviteTeams.inviteId, row.invite.id));

  // Joining and spending the invite are one act. Were the second to fail on its
  // own, the person would be inside and the link would still work - a single
  // invite that admits whoever else it is forwarded to.
  await atomically(database, (on) => [
    ...(already === undefined
      ? [
          // A double click, or two tabs, can both get here; the second is
          // already in, which is the outcome both wanted.
          on
            .insert(memberships)
            .values({
              id: newId("membership"),
              userId: user.id,
              spaceId: row.space.id,
              role: row.invite.role,
            })
            .onConflictDoNothing(),
        ]
      : []),
    // On their teams in the same act as joining, so nobody is ever a member of
    // a company with the access the invitation promised still to come.
    ...joining.map((team) =>
      on
        .insert(teamMembers)
        .values({ id: newId("teamMember"), teamId: team.id, userId: user.id })
        .onConflictDoNothing(),
    ),
    on
      .update(invites)
      .set({ acceptedAt: new Date() })
      .where(eq(invites.id, row.invite.id)),
    // Invited back by an admin: whatever kept them out by domain no longer
    // speaks for the space.
    on
      .delete(spaceJoinBlocks)
      .where(
        and(
          eq(spaceJoinBlocks.spaceId, row.space.id),
          eq(spaceJoinBlocks.email, user.email.toLowerCase()),
        ),
      ),
  ]);

  if (already === undefined) {
    await record({
      spaceId: row.space.id,
      kind: "member-joined",
      actor: user.name,
      actorUserId: user.id,
      subject: user.email,
      detail:
        joining.length === 0
          ? `as ${row.invite.role}, by invitation`
          : `as ${row.invite.role}, by invitation, on ${joining.map((t) => t.name).join(", ")}`,
    });
  }

  return { ok: true, spaceSlug: row.space.slug, spaceName: row.space.name };
}
