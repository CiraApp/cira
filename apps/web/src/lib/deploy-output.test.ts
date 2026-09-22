import { describe, expect, it, vi } from "vitest";
import type * as CiraDeploy from "@cira/deploy";

/**
 * A deploy that failed at its migration shows the migration's output, not a
 * build log that says everything went fine.
 */

const asked: Array<{ what: string; process?: unknown }> = [];

vi.mock("@cira/deploy", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDeploy>();
  return {
    ...actual,
    deploymentProvider: () => ({
      getLogs: () => {
        asked.push({ what: "build" });
        return Promise.resolve([
          { timestamp: new Date(0), message: "Successfully built" },
        ]);
      },
      getRuntimeLogs: (_id: string, query: { process?: unknown }) => {
        asked.push({ what: "runtime", process: query.process });
        return Promise.resolve({
          entries: [
            // As Google writes them beside the command's own output.
            { timestamp: new Date(0), message: "google.cloud.run.v2.Jobs.UpdateJob" },
            {
              timestamp: new Date(0),
              message:
                "/Jobs.UpdateJob: Ready condition status changed to True for Job release-x.",
            },
            {
              timestamp: new Date(1),
              message: "alembic.util.exc.CommandError: bad revision",
            },
            { timestamp: new Date(2), message: "" },
          ],
          nextPageToken: null,
        });
      },
    }),
  };
});

const deploy = (over: Record<string, unknown>) => ({
  providerDeploymentId: "b-1:svc-0000app1:tag",
  status: "failed" as const,
  releaseRun: null,
  releaseStartedAt: null,
  releaseDoneAt: null,
  ...over,
});

describe("deployOutput", () => {
  it("is the release run's own output when the release is where it failed", async () => {
    const { deployOutput } = await import("./deploy-output");
    asked.length = 0;
    const output = await deployOutput(
      deploy({ releaseRun: "e-1", releaseStartedAt: new Date(0) }) as never,
    );
    expect(output.step).toBe("release");
    expect(output.lines.map((l) => l.message)).toEqual([
      "alembic.util.exc.CommandError: bad revision",
    ]);
    expect(asked).toEqual([
      { what: "runtime", process: { kind: "scheduled", name: "release" } },
    ]);
  });

  it("is the build log otherwise, including a release that succeeded", async () => {
    const { deployOutput } = await import("./deploy-output");
    const plain = await deployOutput(deploy({}) as never);
    expect(plain.step).toBe("build");
    const released = await deployOutput(
      deploy({
        releaseRun: "e-1",
        releaseStartedAt: new Date(0),
        releaseDoneAt: new Date(1),
      }) as never,
    );
    expect(released.step).toBe("build");
  });
});
