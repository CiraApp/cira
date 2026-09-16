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

/**
 * Whether a Cloud Run service is serving what it was last told to serve.
 *
 * Two vocabularies, because the API answers in one and documents the other.
 * A `Condition` carries `CONDITION_SUCCEEDED` in practice, while the reference
 * describes a tri-state `TRUE` / `FALSE` / `UNKNOWN`. Both are accepted here
 * rather than picking the one that happened to come back, because the cost of
 * guessing wrong is silent: a service that never reads as ready leaves a
 * deploy saying "deploying" until it times out, with everything about it
 * working. That is exactly what the first real deploy did.
 */
const READINESS: Record<string, Readiness> = {
  CONDITION_SUCCEEDED: "ready",
  TRUE: "ready",
  CONDITION_FAILED: "failed",
  FALSE: "failed",
  CONDITION_PENDING: "pending",
  CONDITION_RECONCILING: "pending",
  UNKNOWN: "pending",
  CONDITION_STATE_UNSPECIFIED: "pending",
};

export type Readiness = "ready" | "failed" | "pending";

/** An unrecognised state is pending, never ready: the costly mistake is
 * telling someone an app is up when it is not. */
export function toReadiness(state: string | undefined): Readiness {
  if (state === undefined) return "pending";
  return READINESS[state.toUpperCase()] ?? "pending";
}
