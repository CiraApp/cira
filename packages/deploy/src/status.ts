import type { DeploymentStatus } from "@cira/core";

/** Every status a deploy stops at. Nothing moves a deploy out of one. */
export const TERMINAL_STATUSES = [
  "live",
  "failed",
  "removed",
  "superseded",
] as const satisfies readonly DeploymentStatus[];

/** Whether there is any point asking the provider again. */
export function isTerminal(status: DeploymentStatus): boolean {
  return (TERMINAL_STATUSES as readonly DeploymentStatus[]).includes(status);
}
