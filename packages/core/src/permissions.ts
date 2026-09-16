import { ROLES, type AppAccess, type Role } from "./model.js";
import type { Capability } from "./capability.js";
import type { App, Membership, SpaceId, TeamId, UserId } from "./model.js";

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
 * Everything about the person asking, gathered in one place.
 *
 * The three facts travel together because any check that has two of them and
 * not the third answers *almost* correctly, and an access check that is almost
 * correct silently hides someone's work from them. A caller that has to build
 * this cannot forget a piece of it.
 */
export interface Principal {
  userId: UserId;
  memberships: readonly Membership[];
  /** Every team this user is on, across every space. */
  teamIds: readonly TeamId[];
}

/**
 * Can this user open this app?
 *
 * Space membership is a precondition, never a grant on its own: being in Acme
 * does not reveal every Acme app, only the ones whose access rules include you.
 */
export function canAccessApp(args: {
  principal: Principal;
  app: App;
  access: readonly AppAccess[];
}): boolean {
  const { principal, app, access } = args;
  const { userId, memberships, teamIds } = principal;

  const membership = membershipIn(memberships, userId, app.spaceId);
  if (membership === undefined) return false;

  // The app's owner never loses sight of their own app.
  if (app.ownerUserId === userId) return true;

  // Admins and owners administer the whole space, so they can see every app.
  if (roleAtLeast(membership.role, "admin")) return true;

  return access.some((rule) => {
    if (rule.appId !== app.id) return false;
    if (rule.type === "space") return rule.targetId === app.spaceId;
    if (rule.type === "team") return teamIds.includes(rule.targetId);
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
  principal: Principal;
  apps: readonly App[];
  access: readonly AppAccess[];
}): App[] {
  const { principal, apps, access } = args;
  return apps.filter((app) => canAccessApp({ principal, app, access }));
}

/**
 * The capabilities this user may discover.
 *
 * Derived from app access and nothing else, which is the whole permission
 * model for capabilities: a capability is something an app does, so the right
 * to use it is the right to use the app. Written here, as a pure function over
 * records, so the registry, the MCP surface and the tests all consult the same
 * rule rather than three copies of it.
 */
export function visibleCapabilities(args: {
  principal: Principal;
  capabilities: readonly Capability[];
  apps: readonly App[];
  access: readonly AppAccess[];
}): Capability[] {
  const { principal, capabilities, apps, access } = args;
  const byId = new Map(apps.map((app) => [app.id, app]));

  return capabilities.filter((capability) => {
    const app = byId.get(capability.appId);
    if (app === undefined) return false;
    return canAccessApp({ principal, app, access });
  });
}

/**
 * May this user actually run this capability?
 *
 * Discovery and invocation share one rule and then diverge on exactly one
 * point: being able to see that an app can do something is not permission to
 * make it do it while it is switched off.
 */
export function canInvokeCapability(args: {
  principal: Principal;
  capability: Capability;
  app: App;
  access: readonly AppAccess[];
}): boolean {
  if (!args.capability.enabled) return false;
  return canAccessApp({
    principal: args.principal,
    app: args.app,
    access: args.access,
  });
}
