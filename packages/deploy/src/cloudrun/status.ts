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

/**
 * Why a new version would not start, from Cloud Run's own message, in words
 * for the person who deployed it.
 *
 * Google's message names its console, its project and a logs URL, none of
 * which the reader has or needs. The common causes are said plainly; anything
 * else keeps Google's first sentence with the links taken out.
 */
export function explainStartFailure(message: string | undefined): string {
  const text = message ?? "";
  if (/listen(ing)? on (the )?port|PORT=\d+/i.test(text)) {
    const port = /PORT=(\d+)/.exec(text)?.[1];
    return (
      `It built, but never started listening${port === undefined ? "" : ` on port ${port}`}. ` +
      "An app has to listen on the port in its PORT variable, and start within four minutes."
    );
  }
  if (/memory limit|out of memory|OOM/i.test(text)) {
    return "It built, but ran out of memory while starting.";
  }
  if (/exit(ed)? (with )?(code|status)|terminated|crash/i.test(text)) {
    return "It built, but stopped as soon as it started. Its runtime logs say why.";
  }
  const first = text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/Logs URL:.*$/is, "")
    .replace(/projects\/[^\s/]+/g, "")
    .split(/(?<=\.)\s/)[0]
    ?.trim();
  return first === undefined || first === ""
    ? "It built, but the new version would not start. Its runtime logs say why."
    : first;
}

/** Why a build failed, from Cloud Build's own summary. */
export function explainBuildFailure(
  state: string | undefined,
  detail: string | undefined,
): string {
  switch (state?.toUpperCase()) {
    case "TIMEOUT":
      return "The build ran past its twenty minutes and was stopped.";
    case "CANCELLED":
      return "The build was cancelled.";
    case "EXPIRED":
      return "The build waited too long to start and expired. Deploying again usually works.";
    case "INTERNAL_ERROR":
      return "The build service had a problem of its own. Deploying again usually works.";
    default: {
      const said = (detail ?? "").replace(/https?:\/\/\S+/g, "").trim();
      return said === ""
        ? "The build failed. Its logs, on the app's page, say where."
        : `The build failed: ${said}. Its logs, on the app's page, say where.`;
    }
  }
}
