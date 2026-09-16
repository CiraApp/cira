import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { appOpens, db, deployments } from "@cira/db";
import type { Deployment } from "@cira/core";
import { newId } from "@cira/core";

/**
 * The deployment currently backing an app. Callers must already have checked
 * access to the app: nothing here re-authorizes.
 */
export async function latestDeployment(appId: string): Promise<Deployment | null> {
  const [row] = await db()
    .select()
    .from(deployments)
    .where(eq(deployments.appId, appId))
    .orderBy(desc(deployments.createdAt))
    .limit(1);

  return row ?? null;
}

/** Every deploy of an app, newest first. */
export async function deploymentHistory(
  appId: string,
  limit = 10,
): Promise<Deployment[]> {
  return db()
    .select()
    .from(deployments)
    .where(eq(deployments.appId, appId))
    .orderBy(desc(deployments.createdAt))
    .limit(limit);
}

/** Remember that someone opened an app, so "Recent" means something. */
export async function recordAppOpen(userId: string, appId: string): Promise<void> {
  const now = new Date();
  await db()
    .insert(appOpens)
    .values({ id: newId("access"), userId, appId, openedAt: now })
    .onConflictDoUpdate({
      target: [appOpens.userId, appOpens.appId],
      set: { openedAt: now },
    });
}

/** The apps this person actually reaches for, most recent first. */
export async function recentlyOpened(
  userId: string,
  appIds: readonly string[],
  limit = 6,
): Promise<string[]> {
  if (appIds.length === 0) return [];

  const rows = await db()
    .select({ appId: appOpens.appId })
    .from(appOpens)
    .where(and(eq(appOpens.userId, userId), inArray(appOpens.appId, [...appIds])))
    .orderBy(desc(appOpens.openedAt))
    .limit(limit);

  return rows.map((r) => r.appId);
}
