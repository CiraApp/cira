import "server-only";

import { eq } from "drizzle-orm";
import { appAccess, db } from "@cira/db";
import { canManageApp } from "@cira/core";
import type { App, AppAccess, Principal, User } from "@cira/core";
import { principalFor } from "@/lib/principal";

/**
 * Who may change an app, answered in one place.
 *
 * The rule is `canManageApp` in core; this is what every server path that
 * starts from a user and an app calls, so none of them can check the owner
 * and the role but forget the grants, which is how a co-manager ends up
 * locked out of an app they were given, or a plain member let into one.
 */

/** Every grant on one app, in the shape the rules in core expect. */
export async function grantsFor(appId: string): Promise<AppAccess[]> {
  return (await db()
    .select()
    .from(appAccess)
    .where(eq(appAccess.appId, appId))) as AppAccess[];
}

/** Whether this principal may manage this app. */
export async function principalManages(principal: Principal, app: App): Promise<boolean> {
  return canManageApp({ principal, app, access: await grantsFor(app.id) });
}

/** Whether this user may manage this app. False for anyone outside its space. */
export async function userManages(user: User, app: App): Promise<boolean> {
  const principal = await principalFor(user);
  if (principal === null) return false;
  return principalManages(principal, app);
}
