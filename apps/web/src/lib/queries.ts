import "server-only";

import { desc, eq } from "drizzle-orm";
import { apps, db, deployments } from "@cira/db";
import type { Deployment } from "@cira/core";

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
 * Does Cira hold the key that lets it open this app?
 *
 * Infrastructure rather than product, so it is answered here and passed in as
 * a plain yes or no rather than hung off the domain type.
 */
export async function appHoldsKey(appId: string): Promise<boolean> {
  const [row] = await db()
    .select({ accessSecret: apps.accessSecret })
    .from(apps)
    .where(eq(apps.id, appId))
    .limit(1);

  return (
    row?.accessSecret !== null &&
    row?.accessSecret !== undefined &&
    row.accessSecret !== ""
  );
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
