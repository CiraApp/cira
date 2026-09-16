import { describe, expect, it } from "vitest";
import { buildFailed, buildSucceeded, toDeploymentStatus, toReadiness } from "./status";

describe("toDeploymentStatus", () => {
  it("maps the states a build passes through", () => {
    expect(toDeploymentStatus("QUEUED")).toBe("queued");
    expect(toDeploymentStatus("WORKING")).toBe("building");
    expect(toDeploymentStatus("SUCCESS")).toBe("deploying");
  });

  it("maps every way a build can end badly", () => {
    for (const state of [
      "FAILURE",
      "INTERNAL_ERROR",
      "TIMEOUT",
      "CANCELLED",
      "EXPIRED",
    ]) {
      expect(toDeploymentStatus(state)).toBe("failed");
    }
  });

  it("never calls a successful build live", () => {
    // The build makes an image. The service that serves it comes after, and
    // saying "live" here points someone at a URL that is not answering.
    expect(toDeploymentStatus("SUCCESS")).not.toBe("live");
  });

  it("treats an unknown state as still in progress", () => {
    // The costly mistake is telling someone an app is ready when it is not,
    // so a state Google adds later reads as building rather than as live.
    expect(toDeploymentStatus("SOMETHING_NEW")).toBe("building");
    expect(toDeploymentStatus(undefined)).toBe("queued");
  });

  it("is case insensitive", () => {
    expect(toDeploymentStatus("success")).toBe("deploying");
  });
});

describe("buildSucceeded and buildFailed", () => {
  it("agree with the mapping", () => {
    expect(buildSucceeded("SUCCESS")).toBe(true);
    expect(buildSucceeded("WORKING")).toBe(false);
    expect(buildFailed("TIMEOUT")).toBe(true);
    expect(buildFailed("WORKING")).toBe(false);
  });

  it("are never both true", () => {
    for (const state of ["QUEUED", "WORKING", "SUCCESS", "FAILURE", "WEIRD", undefined]) {
      expect(buildSucceeded(state) && buildFailed(state)).toBe(false);
    }
  });
});

describe("toReadiness", () => {
  // The value the real API actually returns. It is not the one the reference
  // describes, and coding to the reference made the first real deploy sit at
  // "deploying" until it timed out, with a service that was serving fine.
  it("reads what Cloud Run really says", () => {
    expect(toReadiness("CONDITION_SUCCEEDED")).toBe("ready");
    expect(toReadiness("CONDITION_FAILED")).toBe("failed");
    expect(toReadiness("CONDITION_PENDING")).toBe("pending");
    expect(toReadiness("CONDITION_RECONCILING")).toBe("pending");
  });

  it("also reads what the reference describes", () => {
    expect(toReadiness("TRUE")).toBe("ready");
    expect(toReadiness("FALSE")).toBe("failed");
    expect(toReadiness("UNKNOWN")).toBe("pending");
  });

  it("never calls an unrecognised state ready", () => {
    for (const unknown of ["SOMETHING_NEW", "", "  ", undefined]) {
      expect(toReadiness(unknown)).toBe("pending");
    }
  });
});
