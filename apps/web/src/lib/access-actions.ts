"use server";

import { and, eq, inArray } from "drizzle-orm";
import { appAccess, db, memberships, users } from "@cira/db";
import { newId } from "@cira/core";
import type { Role } from "@cira/core";
import { ForbiddenError, NotFoundError, requireAppManage } from "@/lib/authz";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface SpaceMember {
  userId: string;
  name: string;
  email: string;
  role: Role;
}

export interface AccessEntry {
  id: string;
  kind: "everyone" | "person";
  /** For a person: their name. For everyone: the space name. */
  label: string;
  detail: string | null;
  /** Owners and admins reach every app regardless, so their access is implicit. */
  removable: boolean;
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
): Promise<{ entries: AccessEntry[]; candidates: SpaceMember[] }> {
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

  const byId = new Map(memberRows.map((m) => [m.user.id, m]));
  const entries: AccessEntry[] = [];

  for (const grant of grants) {
    if (grant.type === "space") {
      entries.push({
        id: grant.id,
        kind: "everyone",
        label: `Everyone at ${ctx.space.name}`,
        detail: `${memberRows.length} ${memberRows.length === 1 ? "person" : "people"}`,
        removable: true,
      });
      continue;
    }

    const member = byId.get(grant.targetId);
    entries.push({
      id: grant.id,
      kind: "person",
      label: member?.user.name ?? "Someone no longer in this space",
      detail: member?.user.email ?? null,
      removable: true,
    });
  }

  // The owner and any admin can already open it; saying so prevents someone
  // "fixing" their absence by adding a grant that changes nothing.
  for (const m of memberRows) {
    const implicit = m.user.id === ctx.app.ownerUserId || m.role !== "member";
    const alreadyListed = grants.some(
      (g) => g.type === "user" && g.targetId === m.user.id,
    );
    if (implicit && !alreadyListed) {
      entries.push({
        id: `implicit-${m.user.id}`,
        kind: "person",
        label: m.user.name,
        detail: m.user.id === ctx.app.ownerUserId ? "Owns this app" : `Space ${m.role}`,
        removable: false,
      });
    }
  }

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

  return { entries, candidates };
}

/** Grant one person, or everyone in the space, access to an app. */
export async function grantAccess(
  spaceSlug: string,
  appSlug: string,
  target: { kind: "everyone" } | { kind: "person"; userId: string },
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
      return { ok: true, data: null };
    }

    // The person must already be in this space. Without this check a grant
    // could name anyone, and would sit in the table doing nothing.
    const [member] = await database
      .select({ id: memberships.id })
      .from(memberships)
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
    await db()
      .delete(appAccess)
      .where(and(eq(appAccess.id, grantId), eq(appAccess.appId, ctx.app.id)));

    return { ok: true, data: null };
  } catch (error) {
    return asActionError(error);
  }
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

export async function spaceMemberCount(spaceId: string): Promise<number> {
  const rows = await db()
    .select({ id: memberships.id })
    .from(memberships)
    .where(inArray(memberships.spaceId, [spaceId]));
  return rows.length;
}
