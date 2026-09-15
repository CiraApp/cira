import { ROLES, type AppAccess, type Role } from "./model.js";
import type { App, Membership, SpaceId, UserId } from "./model.js";

/**
 * Every check here takes explicit records rather than reading a request or a
 * session. Callers load the records server-side and pass them in, so a client
 * can never smuggle in a space or user id (spec section 20).
 */

export function roleAtLeast(role: Role, minimum: Role): boolean {
  return ROLES.indexOf(role) >= ROLES.indexOf(minimum);
}

export function membershipIn(
  memberships: readonly Membership[],
  userId: UserId,
  spaceId: SpaceId,
): Membership | undefined {
  return memberships.find((m) => m.userId === userId && m.spaceId === spaceId);
}

export function isSpaceMember(
  memberships: readonly Membership[],
  userId: UserId,
  spaceId: SpaceId,
): boolean {
  return membershipIn(memberships, userId, spaceId) !== undefined;
}

/**
 * Can this user open this app?
 *
 * Space membership is a precondition, never a grant on its own: being in Acme
 * does not reveal every Acme app, only the ones whose access rules include you.
 */
export function canAccessApp(args: {
  userId: UserId;
  app: App;
  memberships: readonly Membership[];
  access: readonly AppAccess[];
}): boolean {
  const { userId, app, memberships, access } = args;

  const membership = membershipIn(memberships, userId, app.spaceId);
  if (membership === undefined) return false;

  // The app's owner never loses sight of their own app.
  if (app.ownerUserId === userId) return true;

  // Admins and owners administer the whole space, so they can see every app.
  if (roleAtLeast(membership.role, "admin")) return true;

  return access.some((rule) => {
    if (rule.appId !== app.id) return false;
    if (rule.type === "space") return rule.targetId === app.spaceId;
    return rule.targetId === userId;
  });
}

/** Can this user change an app's settings, access, or deployments? */
export function canManageApp(args: {
  userId: UserId;
  app: App;
  memberships: readonly Membership[];
}): boolean {
  const { userId, app, memberships } = args;

  const membership = membershipIn(memberships, userId, app.spaceId);
  if (membership === undefined) return false;

  if (app.ownerUserId === userId) return true;
  return roleAtLeast(membership.role, "admin");
}

/** Can this user invite people into the space? */
export function canInviteToSpace(args: {
  userId: UserId;
  spaceId: SpaceId;
  memberships: readonly Membership[];
}): boolean {
  const membership = membershipIn(args.memberships, args.userId, args.spaceId);
  return membership !== undefined && roleAtLeast(membership.role, "admin");
}

/** Can this user deploy a new app into the space? Any member may. */
export function canDeployToSpace(args: {
  userId: UserId;
  spaceId: SpaceId;
  memberships: readonly Membership[];
}): boolean {
  return isSpaceMember(args.memberships, args.userId, args.spaceId);
}

/** The gallery: every app in the space this user is actually allowed to open. */
export function visibleApps(args: {
  userId: UserId;
  apps: readonly App[];
  memberships: readonly Membership[];
  access: readonly AppAccess[];
}): App[] {
  const { userId, apps, memberships, access } = args;
  return apps.filter((app) => canAccessApp({ userId, app, memberships, access }));
}
