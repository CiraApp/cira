import type { DeploymentStatus } from "@cira/core";

/**
 * When to stop believing a deploy is still going.
 *
 * A record saying "deploying" forever is worse than one saying "failed": the
 * first invites someone to keep waiting, the second tells them to act. Builds
 * that genuinely take longer than this are rare enough that the wrong call
 * costs a redeploy, while the wrong call in the other direction costs trust in
 * every status on the page.
 */
export const DEPLOY_PATIENCE_MS = 20 * 60 * 1000;

export type StalenessVerdict =
  | { action: "settled" }
  | { action: "ask-provider" }
  | { action: "declare-failed"; reason: string };

export function checkStaleness(
  deployment: { status: DeploymentStatus; createdAt: Date },
  now: Date = new Date(),
): StalenessVerdict {
  if (
    deployment.status === "live" ||
    deployment.status === "failed" ||
    deployment.status === "removed"
  ) {
    return { action: "settled" };
  }

  const age = now.getTime() - deployment.createdAt.getTime();
  if (age > DEPLOY_PATIENCE_MS) {
    return {
      action: "declare-failed",
      reason: "This deploy stopped responding and never finished.",
    };
  }

  return { action: "ask-provider" };
}
