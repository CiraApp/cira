import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { appAccess, apps, db, memberships, spaces, teamMembers } from "@cira/db";
import {
  canAccessApp,
  canInviteToSpace,
  canManageApp,
  isSlug,
  visibleApps,
} from "@cira/core";
import type {
  App,
  AppAccess,
  Membership,
  Principal,
  Role,
  Space,
  User,
} from "@cira/core";
import { requireCurrentUser } from "@/lib/identity";
import { settleAbandonedDeploys } from "@/lib/deployment-sync";

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
  /** Who is asking, in the shape every access rule in @cira/core expects. */
  principal: Principal;
}

/**
 * Resolve the signed-in user's standing in a space.
 *
 * A space the user is not a member of is reported as *not found* rather than
 * forbidden, so the gallery cannot be used to probe which companies exist.
 */
export async function requireSpaceMember(spaceSlug: string): Promise<SpaceContext> {
  // Reject anything that cannot be a slug before touching the session or the
  // database, so a request for a file that does not exist is an honest 404.
  if (!isSlug(spaceSlug)) throw new NotFoundError("Space");

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

  // Every team, not only this space's: teams are space-scoped, so an id from
  // another company can never match a grant here, and filtering would cost a
  // join to prove something the data already guarantees.
  const teams = await database
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, user.id));

  return {
    user,
    space,
    role: membership.role,
    memberships: rows,
    principal: {
      userId: user.id,
      memberships: rows,
      teamIds: teams.map((t) => t.teamId),
    },
  };
}

/** Every space the signed-in user belongs to. */
export async function listMySpaces(): Promise<Array<Space & { role: Role }>> {
  const user = await requireCurrentUser();
  const database = db();

  // In the order they were joined, so someone in several always lands in the
  // same one - the first - rather than whichever the database returned first.
  const rows = await database
    .select({ space: spaces, role: memberships.role })
    .from(memberships)
    .innerJoin(spaces, eq(memberships.spaceId, spaces.id))
    .where(eq(memberships.userId, user.id))
    .orderBy(asc(memberships.createdAt));

  return rows.map((r) => ({ ...r.space, role: r.role }));
}

/** The gallery: apps in this space that this user is actually allowed to open. */
export async function listVisibleApps(spaceSlug: string): Promise<App[]> {
  const ctx = await requireSpaceMember(spaceSlug);
  const database = db();

  // Nothing in a gallery should claim to be deploying forever.
  await settleAbandonedDeploys(ctx.space.id);

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
    principal: ctx.principal,
    apps: spaceApps,
    access: grants as AppAccess[],
  });
}

export interface AppContext extends SpaceContext {
  app: App;
  /** Every grant on the app, already read to decide whether it opens. */
  grants: AppAccess[];
  /** Whether this user may change the app, by the same grants. */
  manages: boolean;
}

/** The app, if this user may open it. */
/**
 * Where an app renamed away from `oldSlug` lives now - for someone who may
 * open it there. Anyone else gets null, the same as for an address nothing
 * ever answered on: telling a person who cannot see the app what it is now
 * called was telling them it exists, and its new name.
 */
export async function movedAppFor(
  spaceSlug: string,
  oldSlug: string,
): Promise<string | null> {
  const { appSlugMovedTo } = await import("@/lib/queries");
  const moved = await appSlugMovedTo(spaceSlug, oldSlug);
  if (moved === null) return null;
  try {
    await requireAppAccess(spaceSlug, moved);
    return moved;
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) return null;
    throw error;
  }
}

export async function requireAppAccess(
  spaceSlug: string,
  appSlug: string,
): Promise<AppContext> {
  if (!isSlug(appSlug)) throw new NotFoundError("App");

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
    principal: ctx.principal,
    app,
    access: grants as AppAccess[],
  });

  // An app the user cannot open is indistinguishable from one that is not there.
  if (!allowed) throw new NotFoundError("App");

  return {
    ...ctx,
    app,
    grants: grants as AppAccess[],
    manages: canManageApp({
      principal: ctx.principal,
      app,
      access: grants as AppAccess[],
    }),
  };
}

/** The app, if this user may change its settings, access or deployments. */
export async function requireAppManage(
  spaceSlug: string,
  appSlug: string,
): Promise<AppContext> {
  const ctx = await requireAppAccess(spaceSlug, appSlug);
  if (!ctx.manages) throw new ForbiddenError("manage this app");
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
