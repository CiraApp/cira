import "server-only";

import { deploymentProvider } from "@cira/deploy";
import type { Deployment } from "@cira/core";

/**
 * What to show for a deploy: the output of the step it stopped at.
 *
 * Usually the build's. For a deploy that failed at its release command - the
 * migration - the build went fine and its log says nothing useful; the
 * release run's own output is where the error is, and it was nowhere a
 * person could read it.
 */
export async function deployOutput(
  deployment: Pick<
    Deployment,
    | "providerDeploymentId"
    | "status"
    | "releaseRun"
    | "releaseStartedAt"
    | "releaseDoneAt"
  >,
  limit = 200,
): Promise<{
  step: "build" | "release";
  lines: Array<{ timestamp: Date; message: string }>;
}> {
  const provider = deploymentProvider();
  const releaseFailed =
    deployment.status === "failed" &&
    deployment.releaseRun !== null &&
    deployment.releaseDoneAt === null &&
    deployment.releaseStartedAt !== null;

  if (releaseFailed) {
    const page = await provider.getRuntimeLogs(deployment.providerDeploymentId, {
      since: deployment.releaseStartedAt!,
      until: new Date(),
      minimum: "all",
      search: null,
      order: "oldest",
      pageToken: null,
      limit,
      process: { kind: "scheduled", name: "release" },
    });
    return {
      step: "release",
      lines: page.entries
        .filter((entry) => entry.message !== "")
        .map((entry) => ({ timestamp: entry.timestamp, message: entry.message })),
    };
  }

  return {
    step: "build",
    lines: await provider.getLogs(deployment.providerDeploymentId),
  };
}
