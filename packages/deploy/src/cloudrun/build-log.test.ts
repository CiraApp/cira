import { describe, expect, it } from "vitest";
import { readableBuildLog } from "./build-log.js";

/** The end of a real build that failed on production, as Cloud Build stored it. */
const FAILED = [
  "Step #0: #4 sha256:2f17fc044b579bab302c2e8054d3a686e2cb9a83de48e70534b94cd8ebbe06a9 10.37kB / 10.37kB done",
  "Step #0: #4 extracting sha256:6b37362b3da78869050b894b799ad4df04f1f3b52774087db0d81151570244c8 1.1s done",
  "Step #0: #4 DONE 2.7s",
  "Step #0: ",
  "Step #0: #5 [2/4] WORKDIR /app",
  "Step #0: #5 sha256:3cfcba9f9db9368556565ac89665508b3efe67cc4316e028904d4d0d5243b53c",
  "Step #0: #5 DONE 0.5s",
  "Step #0: ",
  "Step #0: #8 [4/4] RUN pip install --no-cache-dir orders-lib==9.9",
  "Step #0: #8 sha256:3cf1e29408e8c4cde7869beeb4a38e12a29310452447abbba481292b7b99d6ae",
  "Step #0: #8 1.930 ERROR: Could not find a version that satisfies the requirement orders-lib==9.9 (from versions: none)",
  "Step #0: #8 2.040 ",
  "Step #0: #8 2.040 [notice] A new release of pip is available: 25.0.1 -> 26.2.1",
  "Step #0: #8 2.040 [notice] To update, run: pip install --upgrade pip",
  "Step #0: #8 2.042 ERROR: No matching distribution found for orders-lib==9.9",
  "Step #0: #8 ERROR: executor failed running [/bin/sh -c pip install --no-cache-dir orders-lib==9.9]: exit code: 1",
  "Step #0: ------",
  "Step #0:  > [4/4] RUN pip install --no-cache-dir orders-lib==9.9:",
  "Step #0: ------",
  "Step #0: executor failed running [/bin/sh -c pip install --no-cache-dir orders-lib==9.9]: exit code: 1",
  "Finished Step #0",
  "ERROR",
  'ERROR: build step 0 "gcr.io/cloud-builders/docker" failed: step exited with non-zero status: 1',
];

describe("readableBuildLog", () => {
  it("keeps each Dockerfile step and what it printed, and nothing about layers", () => {
    expect(readableBuildLog(FAILED)).toEqual([
      "[2/4] WORKDIR /app",
      "",
      "[4/4] RUN pip install --no-cache-dir orders-lib==9.9",
      "ERROR: Could not find a version that satisfies the requirement orders-lib==9.9 (from versions: none)",
      "",
      "ERROR: No matching distribution found for orders-lib==9.9",
      "ERROR: executor failed running [/bin/sh -c pip install --no-cache-dir orders-lib==9.9]: exit code: 1",
    ]);
  });

  it("leaves a build's own output alone, repeated lines included", () => {
    const lines = [
      "Step #0: #9 3.1 compiled 12 pages",
      "Step #0: #9 3.2 done",
      "Step #0: #9 3.3 done",
    ];
    expect(readableBuildLog(lines)).toEqual(["compiled 12 pages", "done", "done"]);
  });
});
