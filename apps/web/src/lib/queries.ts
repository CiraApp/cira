import "server-only";

import { desc, eq } from "drizzle-orm";
import { db, deployments } from "@cira/db";
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
