import "server-only";

import { deploymentProvider } from "@cira/deploy";
import { isProviderRecord, type Deployment } from "@cira/core";

/**
 * What to show for a deploy: the output of the step it stopped at.
 *
 * Usually the build's. For a deploy that failed at its release command - the
 * migration - the build went fine and its log says nothing useful; the
 * release run's own output is where the error is, and it was nowhere a
 * person could read it. The same goes for a deploy that built and then would
 * not start: the build log ends "Successfully built image", and the crash is
 * in what the app printed as it came up.
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
  /** Wait for a failed start's log to be complete, for a reader who asked at once. */
  waitForEnd = false,
): Promise<{
  step: "build" | "release" | "start";
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
        .filter((entry) => entry.message !== "" && !isProviderRecord(entry.message))
        .map((entry) => ({ timestamp: entry.timestamp, message: entry.message })),
    };
  }

  // A version exists only once its build succeeded, so a failed deploy with
  // one to read failed as it started.
  if (deployment.status === "failed" && provider.getStartupLogs !== undefined) {
    const read = async () =>
      (
        (await provider
          .getStartupLogs?.(deployment.providerDeploymentId, limit)
          .catch(() => null)) ?? []
      ).filter(
        (entry) =>
          entry.message !== "" &&
          !isProviderRecord(entry.message) &&
          !STARTING.test(entry.message),
      );

    // Google takes a few seconds to file what a container printed, and the
    // terminal asks the moment the deploy fails: read then, it had the first
    // lines of the stack trace and not the one naming the missing file. So it
    // waits, briefly, for Cloud Run's own last word on the container.
    let printed = await read();
    for (let waited = 0; waitForEnd && !ended(printed) && waited < SETTLE_MS;) {
      await new Promise((resolve) => setTimeout(resolve, SETTLE_STEP_MS));
      waited += SETTLE_STEP_MS;
      printed = await read();
    }
    if (printed.length > 0) return { step: "start", lines: printed };
  }

  return {
    step: "build",
    lines: await provider.getLogs(deployment.providerDeploymentId),
  };
}

/** Cloud Run noting that it started a container, which says nothing about why it failed. */
const STARTING = /^Starting new instance\. Reason:/;

/** Cloud Run's own account of a container that did not come up: its last word on it. */
function ended(lines: ReadonlyArray<{ message: string }>): boolean {
  return lines.some((line) =>
    /Container called exit|STARTUP \w+ probe failed|The instance was not started|Container terminated/i.test(
      line.message,
    ),
  );
}

const SETTLE_MS = 15_000;
const SETTLE_STEP_MS = 2_500;
