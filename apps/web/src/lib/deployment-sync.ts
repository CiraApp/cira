import "server-only";

import { and, eq, notInArray } from "drizzle-orm";
import { apps, db, deployments } from "@cira/db";
import type { Deployment } from "@cira/core";
import { deploymentProvider, isTerminal } from "@cira/deploy";
import { checkStaleness } from "@/lib/deployment-staleness";

/**
 * Bring a deployment record back in line with what actually happened.
 *
 * Called wherever someone looks at a deploy, rather than from a background
 * job: the moment a person is looking is exactly when the answer has to be
 * true, and it saves running a poller for something nobody is watching.
 */
export async function reconcileDeployment(deployment: Deployment): Promise<Deployment> {
  const verdict = checkStaleness(deployment);
  if (verdict.action === "settled") return deployment;

  const database = db();

  if (verdict.action === "declare-failed") {
    await database
      .update(deployments)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(deployments.id, deployment.id));
    await database
      .update(apps)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(apps.id, deployment.appId));

    return { ...deployment, status: "failed" };
  }

  let live;
  try {
    live = await deploymentProvider().getStatus(deployment.providerDeploymentId);
  } catch {
    // The provider being briefly unreachable is not news about the deploy.
    return deployment;
  }

  if (live.status === deployment.status && live.url === deployment.url) {
    return deployment;
  }

  await database
    .update(deployments)
    .set({ status: live.status, url: live.url, updatedAt: new Date() })
    .where(eq(deployments.id, deployment.id));

  if (isTerminal(live.status)) {
    await database
      .update(apps)
      .set({
        status: live.status === "live" ? "live" : "failed",
        updatedAt: new Date(),
      })
      .where(eq(apps.id, deployment.appId));
  }

  return { ...deployment, status: live.status, url: live.url };
}

/**
 * Settle deploys that were plainly abandoned, without asking the provider.
 *
 * Cheap enough to run whenever a gallery is drawn, because it makes no network
 * calls: it only acts on records old enough that no answer is coming. The
 * gallery is where a permanently spinning app is most visible and most
 * corrosive, so it is worth doing there.
 */
export async function settleAbandonedDeploys(spaceId: string): Promise<void> {
  const database = db();

  const stuck = await database
    .select({ deployment: deployments, appId: apps.id })
    .from(deployments)
    .innerJoin(apps, eq(apps.id, deployments.appId))
    .where(
      and(
        eq(apps.spaceId, spaceId),
        notInArray(deployments.status, ["live", "failed", "removed"]),
      ),
    );

  const now = new Date();

  for (const row of stuck) {
    if (checkStaleness(row.deployment, now).action !== "declare-failed") continue;

    await database
      .update(deployments)
      .set({ status: "failed", updatedAt: now })
      .where(eq(deployments.id, row.deployment.id));
    await database
      .update(apps)
      .set({ status: "failed", updatedAt: now })
      .where(eq(apps.id, row.appId));
  }
}
