import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { appAccess, apps, db, memberships, spaces } from "@cira/db";
import { canAccessApp, canInviteToSpace, canManageApp, visibleApps } from "@cira/core";
import type { App, AppAccess, Membership, Role, Space, User } from "@cira/core";
import { requireCurrentUser } from "@/lib/identity";

/**
 * Every entry point here resolves the acting user from the session, never from
 * anything the client sent. Callers may pass a space or app *slug* (it is in
 * the URL and is public), but never a user id or a space id (spec section 20).
 */

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends Error {
  constructor(action: string) {
    super(`Not allowed to ${action}`);
    this.name = "ForbiddenError";
  }
}

export interface SpaceContext {
  user: User;
  space: Space;
  role: Role;
  memberships: Membership[];
}

/**
 * Resolve the signed-in user's standing in a space.
 *
 * A space the user is not a member of is reported as *not found* rather than
 * forbidden, so the gallery cannot be used to probe which companies exist.
 */
export async function requireSpaceMember(spaceSlug: string): Promise<SpaceContext> {
  const user = await requireCurrentUser();
  const database = db();

  const [space] = await database
    .select()
    .from(spaces)
    .where(eq(spaces.slug, spaceSlug))
    .limit(1);

  if (space === undefined) throw new NotFoundError("Space");

  const rows = await database
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), eq(memberships.spaceId, space.id)));

  const membership = rows[0];
  if (membership === undefined) throw new NotFoundError("Space");

  return {
    user,
    space,
    role: membership.role,
    memberships: rows,
  };
}

/** Every space the signed-in user belongs to. */
export async function listMySpaces(): Promise<Array<Space & { role: Role }>> {
  const user = await requireCurrentUser();
  const database = db();

  const rows = await database
    .select({ space: spaces, role: memberships.role })
    .from(memberships)
    .innerJoin(spaces, eq(memberships.spaceId, spaces.id))
    .where(eq(memberships.userId, user.id));

  return rows.map((r) => ({ ...r.space, role: r.role }));
}

/** The gallery: apps in this space that this user is actually allowed to open. */
export async function listVisibleApps(spaceSlug: string): Promise<App[]> {
  const ctx = await requireSpaceMember(spaceSlug);
  const database = db();

  const spaceApps = await database
    .select()
    .from(apps)
    .where(eq(apps.spaceId, ctx.space.id));

  if (spaceApps.length === 0) return [];

  const grants = await database
    .select()
    .from(appAccess)
    .where(
      inArray(
        appAccess.appId,
        spaceApps.map((a) => a.id),
      ),
    );

  return visibleApps({
    userId: ctx.user.id,
    apps: spaceApps,
    memberships: ctx.memberships,
    access: grants as AppAccess[],
  });
}

export interface AppContext extends SpaceContext {
  app: App;
}

/** The app, if this user may open it. */
export async function requireAppAccess(
  spaceSlug: string,
  appSlug: string,
): Promise<AppContext> {
  const ctx = await requireSpaceMember(spaceSlug);
  const database = db();

  const [app] = await database
    .select()
    .from(apps)
    .where(and(eq(apps.spaceId, ctx.space.id), eq(apps.slug, appSlug)))
    .limit(1);

  if (app === undefined) throw new NotFoundError("App");

  const grants = await database
    .select()
    .from(appAccess)
    .where(eq(appAccess.appId, app.id));

  const allowed = canAccessApp({
    userId: ctx.user.id,
    app,
    memberships: ctx.memberships,
    access: grants as AppAccess[],
  });

  // An app the user cannot open is indistinguishable from one that is not there.
  if (!allowed) throw new NotFoundError("App");

  return { ...ctx, app };
}

/** The app, if this user may change its settings, access or deployments. */
export async function requireAppManage(
  spaceSlug: string,
  appSlug: string,
): Promise<AppContext> {
  const ctx = await requireAppAccess(spaceSlug, appSlug);

  const allowed = canManageApp({
    userId: ctx.user.id,
    app: ctx.app,
    memberships: ctx.memberships,
  });

  if (!allowed) throw new ForbiddenError("manage this app");
  return ctx;
}

/** Throws unless this user may invite people into the space. */
export async function requireInviteRights(spaceSlug: string): Promise<SpaceContext> {
  const ctx = await requireSpaceMember(spaceSlug);

  const allowed = canInviteToSpace({
    userId: ctx.user.id,
    spaceId: ctx.space.id,
    memberships: ctx.memberships,
  });

  if (!allowed) throw new ForbiddenError("invite people to this space");
  return ctx;
}
