import type { DeploymentStatus } from "@cira/core";

/**
 * Cloud Build's vocabulary translated into Cira's.
 *
 * Kept as data for the same reason Vercel's is: a state Google adds shows up
 * here as one unknown value rather than as an app that silently reads as live.
 *
 * A successful build is only `deploying`, never `live`. The build produces an
 * image; the service that serves it is created afterwards, and calling that
 * moment "live" would point people at a URL that is not answering yet.
 */
const BUILD_STATES: Record<string, DeploymentStatus> = {
  STATUS_UNKNOWN: "queued",
  PENDING: "queued",
  QUEUED: "queued",
  WORKING: "building",
  SUCCESS: "deploying",
  FAILURE: "failed",
  INTERNAL_ERROR: "failed",
  TIMEOUT: "failed",
  CANCELLED: "failed",
  EXPIRED: "failed",
};

export function toDeploymentStatus(buildState: string | undefined): DeploymentStatus {
  if (buildState === undefined) return "queued";
  return BUILD_STATES[buildState.toUpperCase()] ?? "building";
}

/** Whether a build finished badly, so the caller stops waiting for a service. */
export function buildFailed(buildState: string | undefined): boolean {
  return toDeploymentStatus(buildState) === "failed";
}

/** Whether the image exists and the service can now be pointed at it. */
export function buildSucceeded(buildState: string | undefined): boolean {
  return buildState?.toUpperCase() === "SUCCESS";
}
