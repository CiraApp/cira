import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import {
  appOpens,
  apps,
  appSlugHistory,
  db,
  deployments,
  services,
  spaces,
} from "@cira/db";
import type { Deployment, Service } from "@cira/core";
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

/**
 * The build an app is serving: its newest deploy that went live. Newer ones
 * still building, failed or superseded never took the traffic, so the last
 * live one still has it.
 */
export async function servingDeployment(appId: string): Promise<Deployment | null> {
  const [row] = await db()
    .select()
    .from(deployments)
    .where(and(eq(deployments.appId, appId), eq(deployments.status, "live")))
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

/**
 * The parts an app is built from.
 *
 * Ordered with the front door first, because that is the half a person is
 * asking about when they wonder what they are looking at; the rest are behind
 * it in every sense.
 */
export async function listServicesForApp(appId: string): Promise<Service[]> {
  const rows = await db().select().from(services).where(eq(services.appId, appId));

  return rows
    .map((row) => ({
      id: row.id,
      appId: row.appId,
      slug: row.slug,
      sourcePath: row.sourcePath,
      dockerfile: row.dockerfile,
      port: row.port,
      hasWebUi: row.hasWebUi,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))
    .sort(
      (a, b) =>
        Number(b.hasWebUi === true) - Number(a.hasWebUi === true) ||
        a.slug.localeCompare(b.slug),
    );
}

/**
 * The app an address used to belong to, if it belonged to one.
 *
 * Consulted only when nothing answers on that address now, so a live app
 * always wins over a forwarding note and this can never shadow one. It returns
 * a slug rather than an app because it grants nothing: the caller redirects,
 * and the ordinary access check happens there, exactly as it would have.
 */
export async function appSlugMovedTo(
  spaceSlug: string,
  oldSlug: string,
): Promise<string | null> {
  const [row] = await db()
    .select({ slug: apps.slug })
    .from(appSlugHistory)
    .innerJoin(apps, eq(apps.id, appSlugHistory.appId))
    .innerJoin(spaces, eq(spaces.id, appSlugHistory.spaceId))
    .where(and(eq(spaces.slug, spaceSlug), eq(appSlugHistory.slug, oldSlug)))
    .limit(1);

  return row?.slug ?? null;
}
