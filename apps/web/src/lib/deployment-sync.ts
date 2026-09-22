import "server-only";

import { and, eq, gt, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
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
    return recordDeploymentStatus(deployment, {
      status: "failed",
      url: deployment.url,
      reason: verdict.reason,
    });
  }

  let live;
  try {
    live = await deploymentProvider().getStatus(deployment.providerDeploymentId, {
      releaseDone: deployment.releaseDoneAt !== null,
    });
  } catch {
    // The provider being briefly unreachable is not news about the deploy.
    return deployment;
  }

  if (live.release === "needed") return driveRelease(deployment);

  if (live.status === deployment.status && live.url === deployment.url) {
    return deployment;
  }

  return recordDeploymentStatus(deployment, {
    status: live.status,
    url: live.url,
    ...(live.reason === undefined ? {} : { reason: live.reason }),
    ...(live.warning === undefined ? {} : { warning: live.warning }),
  });
}

/** How long a claim to start a release stands before another poll may retry. */
const RELEASE_CLAIM_MS = 3 * 60_000;

/**
 * Run the release command - the migration - exactly once, then report on it.
 *
 * Several things poll a deploy at once, and the release must not run twice,
 * so starting it is claimed first by a conditional write on the deploy's own
 * row. Only the poll whose write lands starts it; a claim that never got as
 * far as naming its run is given up after a few minutes. A failed release
 * fails the deploy with nothing rolled out: the previous version is still
 * what serves, on the schema it expects.
 */
async function driveRelease(deployment: Deployment): Promise<Deployment> {
  const database = db();
  const provider = deploymentProvider();
  const now = new Date();

  if (deployment.releaseRun === null) {
    const claimed = await database
      .update(deployments)
      .set({ releaseStartedAt: now, updatedAt: now })
      .where(
        and(
          eq(deployments.id, deployment.id),
          isNull(deployments.releaseRun),
          or(
            isNull(deployments.releaseStartedAt),
            lt(deployments.releaseStartedAt, new Date(now.getTime() - RELEASE_CLAIM_MS)),
          ),
        ),
      )
      .returning({ id: deployments.id });
    if (claimed.length === 0 || provider.startRelease === undefined) return deployment;

    let run: string;
    try {
      run = await provider.startRelease(deployment.providerDeploymentId);
    } catch {
      // Let the next poll try, rather than waiting out the claim.
      await database
        .update(deployments)
        .set({ releaseStartedAt: null })
        .where(eq(deployments.id, deployment.id));
      return deployment;
    }
    await database
      .update(deployments)
      .set({ releaseRun: run })
      .where(eq(deployments.id, deployment.id));
    return { ...deployment, releaseStartedAt: now, releaseRun: run };
  }

  if (provider.releaseState === undefined) return deployment;
  let state;
  try {
    state = await provider.releaseState(
      deployment.providerDeploymentId,
      deployment.releaseRun,
    );
  } catch {
    return deployment;
  }

  if (state.state === "running") return deployment;
  if (state.state === "failed") {
    return recordDeploymentStatus(deployment, {
      status: "failed",
      url: deployment.url,
      reason: `${state.reason} Nothing from this deploy was put live; the previous version is still serving.`,
    });
  }

  await database
    .update(deployments)
    .set({ releaseDoneAt: now, updatedAt: now })
    .where(eq(deployments.id, deployment.id));
  // Straight on to the rollout, rather than a poll later.
  return reconcileDeployment({ ...deployment, releaseDoneAt: now });
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
  next: {
    status: DeploymentStatus;
    url: string | null;
    reason?: string;
    warning?: string;
  },
): Promise<Deployment> {
  const database = db();
  const now = new Date();
  const failureReason = next.status === "failed" ? (next.reason ?? null) : null;
  // A warning from the start of the deploy stands until a newer one replaces it.
  const warning = next.warning ?? deployment.warning ?? null;

  const moved = await database
    .update(deployments)
    .set({ status: next.status, url: next.url, failureReason, warning, updatedAt: now })
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
          reason: failureReason,
        }),
    });
  }

  return { ...deployment, status: next.status, url: next.url, failureReason, warning };
}

/** Whether a newer deploy of the same app has started since this one. */
async function isSuperseded(deployment: Deployment): Promise<boolean> {
  // Compared with the row's own timestamp in the database, never the copy in
  // hand: Postgres keeps microseconds and a JavaScript Date keeps
  // milliseconds, so the copy is a little earlier than the row it came from -
  // and every deploy found itself "newer" than itself and stopped before it
  // could go out.
  const [newer] = await db()
    .select({ id: deployments.id })
    .from(deployments)
    .where(
      and(
        eq(deployments.appId, deployment.appId),
        ne(deployments.id, deployment.id),
        gt(
          deployments.createdAt,
          sql`(select ${deployments.createdAt} from ${deployments} where ${deployments.id} = ${deployment.id})`,
        ),
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

  await settleStrandedApps(spaceId, now);
}

/** Long past any deploy request's own time limit. */
const STRANDED_AFTER_MS = 10 * 60_000;

/**
 * An app marked deploying with no deploy behind it: the request that started
 * one was cut off before it wrote its record, and nothing else would ever say
 * otherwise. It goes back to what its last deploy says - live when one is, and
 * failed when none ever got there - instead of "deploying" for good.
 */
async function settleStrandedApps(spaceId: string, now: Date): Promise<void> {
  const database = db();
  const deploying = await database
    .select({ id: apps.id })
    .from(apps)
    .where(
      and(
        eq(apps.spaceId, spaceId),
        eq(apps.status, "deploying"),
        lt(apps.updatedAt, new Date(now.getTime() - STRANDED_AFTER_MS)),
      ),
    );

  for (const app of deploying) {
    const history = await database
      .select({ status: deployments.status })
      .from(deployments)
      .where(eq(deployments.appId, app.id));
    if (history.some((d) => !isTerminal(d.status))) continue;
    await database
      .update(apps)
      .set({
        status: history.some((d) => d.status === "live") ? "live" : "failed",
        updatedAt: now,
      })
      .where(and(eq(apps.id, app.id), eq(apps.status, "deploying")));
  }
}
