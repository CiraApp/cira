"use server";

import { and, eq } from "drizzle-orm";
import { db, memberships, spaceJoinBlocks, spaces } from "@cira/db";
import { isSlug, newId } from "@cira/core";
import type { Space } from "@cira/core";
import { requireCurrentUser } from "@/lib/identity";
import { claimableDomain } from "@/lib/email-domain";

export type JoinResult = { ok: true; spaceSlug: string } | { ok: false; error: string };

/**
 * Spaces the signed-in person can join on the strength of their company email.
 *
 * This is what stops the second employee at a company founding a duplicate of
 * their own workplace: they are offered the real one instead of a blank
 * "create your space" form.
 */
export async function joinableSpaces(): Promise<Space[]> {
  const user = await requireCurrentUser();
  const domain = claimableDomain(user.email);
  if (domain === null) return [];

  const database = db();

  // Only spaces whose admins chose to let their domain in. It used to be every
  // space with a company-looking founder, with no way to say no.
  const candidates = await database
    .select()
    .from(spaces)
    .where(and(eq(spaces.domain, domain), eq(spaces.joinByDomain, true)));

  if (candidates.length === 0) return [];

  const mine = await database
    .select({ spaceId: memberships.spaceId })
    .from(memberships)
    .where(eq(memberships.userId, user.id));
  const blocked = await database
    .select({ spaceId: spaceJoinBlocks.spaceId })
    .from(spaceJoinBlocks)
    .where(eq(spaceJoinBlocks.email, user.email.toLowerCase()));

  const out = new Set([...mine.map((m) => m.spaceId), ...blocked.map((b) => b.spaceId)]);
  return candidates.filter((s) => !out.has(s.id));
}

/**
 * Join a space by company domain.
 *
 * The domain is re-checked here rather than trusted from the form: the slug
 * arrives from the client, the entitlement does not.
 */
export async function joinSpaceByDomain(spaceSlug: string): Promise<JoinResult> {
  if (!isSlug(spaceSlug)) return { ok: false, error: "That space does not exist." };

  const user = await requireCurrentUser();
  const domain = claimableDomain(user.email);
  if (domain === null) {
    return { ok: false, error: "Your email address is not a company address." };
  }

  const database = db();

  const [space] = await database
    .select()
    .from(spaces)
    .where(eq(spaces.slug, spaceSlug))
    .limit(1);

  if (space === undefined || space.domain !== domain || !space.joinByDomain) {
    return { ok: false, error: "That space does not exist." };
  }

  // Someone an admin removed does not get back in by having the address.
  // Being invited again is how they return.
  const [blocked] = await database
    .select({ id: spaceJoinBlocks.id })
    .from(spaceJoinBlocks)
    .where(
      and(
        eq(spaceJoinBlocks.spaceId, space.id),
        eq(spaceJoinBlocks.email, user.email.toLowerCase()),
      ),
    )
    .limit(1);
  if (blocked !== undefined) {
    return {
      ok: false,
      error: `You were removed from ${space.name}. Ask one of its admins to invite you back.`,
    };
  }

  const [already] = await database
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), eq(memberships.spaceId, space.id)))
    .limit(1);

  if (already === undefined) {
    await database.insert(memberships).values({
      id: newId("membership"),
      userId: user.id,
      spaceId: space.id,
      role: "member",
    });
  }

  return { ok: true, spaceSlug: space.slug };
}
