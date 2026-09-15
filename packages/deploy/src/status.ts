import type { DeploymentStatus } from "@cira/core";

/**
 * Vercel's vocabulary translated into Cira's.
 *
 * Kept as data rather than scattered comparisons so a provider adding a state
 * shows up as one unknown value here instead of as an app that silently reads
 * as live.
 */
const VERCEL_STATES: Record<string, DeploymentStatus> = {
  QUEUED: "queued",
  INITIALIZING: "building",
  BUILDING: "building",
  UPLOADING: "building",
  DEPLOYING: "deploying",
  READY: "live",
  ERROR: "failed",
  CANCELED: "failed",
  DELETED: "removed",
};

/**
 * An unrecognised state is treated as still in progress, never as live: the
 * costly mistake is telling someone an app is ready when it is not.
 */
export function toDeploymentStatus(vercelState: string | undefined): DeploymentStatus {
  if (vercelState === undefined) return "queued";
  return VERCEL_STATES[vercelState.toUpperCase()] ?? "building";
}

export function isTerminal(status: DeploymentStatus): boolean {
  return status === "live" || status === "failed" || status === "removed";
}
