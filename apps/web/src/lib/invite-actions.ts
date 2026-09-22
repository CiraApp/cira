"use server";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  atomically,
  db,
  invites,
  memberships,
  spaceJoinBlocks,
  spaces,
  users,
} from "@cira/db";
import { isInviteToken, newId, newInviteToken } from "@cira/core";
import { hashToken } from "@/lib/token-hash";
import type { Role } from "@cira/core";
import { requireCurrentUser } from "@/lib/identity";
import { ForbiddenError, requireInviteRights } from "@/lib/authz";
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
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the details and try again.",
    };
  }

  const { spaceSlug, email, role } = parsed.data;

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

  const token = newInviteToken();
  const expiresAt = inviteExpiry();
  await database.insert(invites).values({
    id: newId("invite"),
    spaceId: ctx.space.id,
    email,
    role: role as Role,
    // The link is sent and returned once, below, and only its hash is kept.
    tokenHash: hashToken(token),
    invitedByUserId: ctx.user.id,
    expiresAt,
  });

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
    }),
  });

  return { ok: true, data: { url: path, email, emailed: sent.sent } };
}

export async function revokeInvite(
  spaceSlug: string,
  inviteId: string,
): Promise<ActionResult<null>> {
  try {
    const ctx = await requireInviteRights(spaceSlug);
    await db()
      .delete(invites)
      .where(and(eq(invites.id, inviteId), eq(invites.spaceId, ctx.space.id)));
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

  return { ok: true, spaceSlug: row.space.slug, spaceName: row.space.name };
}
