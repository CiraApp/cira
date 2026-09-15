"use server";

import { and, eq } from "drizzle-orm";
import { db, memberships, spaces } from "@cira/db";
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

  const candidates = await database
    .select()
    .from(spaces)
    .where(eq(spaces.domain, domain));

  if (candidates.length === 0) return [];

  const mine = await database
    .select({ spaceId: memberships.spaceId })
    .from(memberships)
    .where(eq(memberships.userId, user.id));

  const joined = new Set(mine.map((m) => m.spaceId));
  return candidates.filter((s) => !joined.has(s.id));
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

  if (space === undefined || space.domain !== domain) {
    return { ok: false, error: "That space does not exist." };
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
