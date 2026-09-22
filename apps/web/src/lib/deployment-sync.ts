import "server-only";

import { and, eq, gt, ne, notInArray } from "drizzle-orm";
import { apps, db, deployments } from "@cira/db";
import type { Deployment, DeploymentStatus } from "@cira/core";
import { TERMINAL_STATUSES, deploymentProvider, isTerminal } from "@cira/deploy";
import { checkStaleness } from "@/lib/deployment-staleness";
import { deployFailedMessage } from "@/lib/messages";
import { notifyManagers } from "@/lib/notify";

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

  // Asking the provider about a deploy is also what rolls it out once its
  // build is done. A deploy a newer one replaced must never get that far, or
  // its build finishing late would take production back to older code.
  if (await isSuperseded(deployment)) {
    return recordDeploymentStatus(deployment, {
      status: "superseded",
      url: deployment.url,
    });
  }

  if (verdict.action === "declare-failed") {
    return recordDeploymentStatus(deployment, { status: "failed", url: deployment.url });
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

  return recordDeploymentStatus(deployment, live);
}

/**
 * Write down what a deploy in flight has become, and the app's status with it.
 *
 * The one place a deploy's status changes after it starts, reached from the
 * CLI polling it, from someone opening the app, from the gallery settling
 * abandoned ones and from the watcher. Only a deploy still in flight is
 * changed - the condition is in the write itself, so when two of those arrive
 * at once exactly one of them moves it - and the one that moves it to failed
 * tells the app's managers.
 */
export async function recordDeploymentStatus(
  deployment: Deployment,
  next: { status: DeploymentStatus; url: string | null },
): Promise<Deployment> {
  const database = db();
  const now = new Date();

  const moved = await database
    .update(deployments)
    .set({ status: next.status, url: next.url, updatedAt: now })
    .where(
      and(
        eq(deployments.id, deployment.id),
        notInArray(deployments.status, [...TERMINAL_STATUSES]),
      ),
    )
    .returning({ id: deployments.id });
  if (moved.length === 0) return deployment;

  // A replaced deploy says nothing about the app: the one replacing it does.
  if (isTerminal(next.status) && next.status !== "superseded") {
    await database
      .update(apps)
      .set({ status: next.status === "live" ? "live" : "failed", updatedAt: now })
      .where(eq(apps.id, deployment.appId));
  }

  if (next.status === "failed") {
    const [earlier] = await database
      .select({ id: deployments.id })
      .from(deployments)
      .where(
        and(
          eq(deployments.appId, deployment.appId),
          eq(deployments.status, "live"),
          ne(deployments.id, deployment.id),
        ),
      )
      .limit(1);
    await notifyManagers({
      appId: deployment.appId,
      kind: "deploy-failed",
      subject: deployment.id,
      compose: (app) =>
        deployFailedMessage({
          app,
          startedAt: deployment.createdAt,
          stillRunningEarlier: earlier !== undefined,
        }),
    });
  }

  return { ...deployment, status: next.status, url: next.url };
}

/** Whether a newer deploy of the same app has started since this one. */
async function isSuperseded(deployment: Deployment): Promise<boolean> {
  const [newer] = await db()
    .select({ id: deployments.id })
    .from(deployments)
    .where(
      and(
        eq(deployments.appId, deployment.appId),
        gt(deployments.createdAt, deployment.createdAt),
      ),
    )
    .limit(1);
  return newer !== undefined;
}

/**
 * Mark every deploy of an app still in flight, other than this one, as
 * replaced by it. Called the moment a deploy starts, so there is never a
 * window in which two builds of one app are both waiting to be rolled out.
 */
export async function supersedeEarlierDeploys(
  appId: string,
  deploymentId: string,
): Promise<void> {
  await db()
    .update(deployments)
    .set({ status: "superseded", updatedAt: new Date() })
    .where(
      and(
        eq(deployments.appId, appId),
        ne(deployments.id, deploymentId),
        notInArray(deployments.status, [...TERMINAL_STATUSES]),
      ),
    );
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
        notInArray(deployments.status, [...TERMINAL_STATUSES]),
      ),
    );

  const now = new Date();

  for (const row of stuck) {
    if (checkStaleness(row.deployment, now).action !== "declare-failed") continue;
    await recordDeploymentStatus(row.deployment as Deployment, {
      status: "failed",
      url: row.deployment.url,
    });
  }
}
