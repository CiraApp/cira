import { describe, expect, it } from "vitest";
import { isTerminal, toDeploymentStatus } from "./status.js";

describe("toDeploymentStatus", () => {
  it("maps the states Vercel actually reports", () => {
    expect(toDeploymentStatus("READY")).toBe("live");
    expect(toDeploymentStatus("BUILDING")).toBe("building");
    expect(toDeploymentStatus("ERROR")).toBe("failed");
    expect(toDeploymentStatus("CANCELED")).toBe("failed");
    expect(toDeploymentStatus("DELETED")).toBe("removed");
    expect(toDeploymentStatus("QUEUED")).toBe("queued");
  });

  it("is case insensitive", () => {
    expect(toDeploymentStatus("ready")).toBe("live");
  });

  it("never reports an unknown state as live", () => {
    for (const unknown of ["SOMETHING_NEW", "", "  ", "PAUSED"]) {
      const mapped = toDeploymentStatus(unknown);
      expect(mapped).not.toBe("live");
      expect(mapped).toBe("building");
    }
  });

  it("treats a missing state as not yet started", () => {
    expect(toDeploymentStatus(undefined)).toBe("queued");
  });
});

describe("isTerminal", () => {
  it("knows when to stop polling", () => {
    expect(isTerminal("live")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("removed")).toBe(true);
    expect(isTerminal("building")).toBe(false);
    expect(isTerminal("queued")).toBe(false);
    expect(isTerminal("deploying")).toBe(false);
  });
});
