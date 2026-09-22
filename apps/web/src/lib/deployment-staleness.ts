import type { DeploymentStatus } from "@cira/core";
import { isTerminal } from "@cira/deploy";

/**
 * When to stop believing a deploy is still going.
 *
 * A record saying "deploying" forever is worse than one saying "failed": the
 * first invites someone to keep waiting, the second tells them to act. But
 * the wrong call the other way is worse still - a build that is allowed to
 * take twenty minutes, declared failed at twenty while its code goes on to
 * serve, emails every manager that a working deploy broke. So the patience is
 * the longest a build may run (`BUILD_TIMEOUT` in the Cloud Run provider),
 * plus time for the new revision to start and for the watcher, which runs
 * every five minutes, to see it through.
 */
export const DEPLOY_PATIENCE_MS = 35 * 60 * 1000;

export type StalenessVerdict =
  | { action: "settled" }
  | { action: "ask-provider" }
  | { action: "declare-failed"; reason: string };

export function checkStaleness(
  deployment: {
    status: DeploymentStatus;
    createdAt: Date;
    releaseStartedAt?: Date | null;
  },
  now: Date = new Date(),
): StalenessVerdict {
  if (isTerminal(deployment.status)) return { action: "settled" };

  // A release command gets the same patience again from when it started:
  // a long migration after a long build is not a deploy that stopped.
  const since = deployment.releaseStartedAt ?? deployment.createdAt;
  const age = now.getTime() - since.getTime();
  if (age > DEPLOY_PATIENCE_MS) {
    return {
      action: "declare-failed",
      reason: "This deploy stopped responding and never finished.",
    };
  }

  return { action: "ask-provider" };
}
