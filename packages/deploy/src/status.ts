import type { DeploymentStatus } from "@cira/core";

/** Whether there is any point asking the provider again. */
export function isTerminal(status: DeploymentStatus): boolean {
  return status === "live" || status === "failed" || status === "removed";
}
