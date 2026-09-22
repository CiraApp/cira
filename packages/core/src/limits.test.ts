import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIMITS,
  checkDeployRate,
  checkInvocationRate,
  checkNewApp,
  appMemory,
  describeAppAllowance,
  settleAppMemory,
  type Limits,
} from "./limits.js";

const small: Limits = {
  ...DEFAULT_LIMITS,
  appsPerSpace: 2,
  deploysPerSpacePerHour: 3,
  invocationsPerPersonPerMinute: 2,
};

const now = new Date("2026-09-19T12:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describe("checkNewApp", () => {
  it("allows up to the limit and says what to do past it", () => {
    expect(checkNewApp(1, small)).toEqual({ ok: true });
    const full = checkNewApp(2, small);
    expect(full.ok).toBe(false);
    expect(!full.ok && full.message).toContain("already has 2 apps");
  });
});

describe("checkDeployRate", () => {
  it("counts only the last hour", () => {
    expect(
      checkDeployRate([minutesAgo(70), minutesAgo(65), minutesAgo(61)], now, small),
    ).toEqual({ ok: true });
    expect(checkDeployRate([minutesAgo(10), minutesAgo(5)], now, small)).toEqual({
      ok: true,
    });
  });

  it("says when the oldest deploy in the window leaves it", () => {
    const verdict = checkDeployRate(
      [minutesAgo(45), minutesAgo(10), minutesAgo(1)],
      now,
      small,
    );
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.message).toContain("Try again in 15 minutes.");

    const almost = checkDeployRate(
      [minutesAgo(59.9), minutesAgo(10), minutesAgo(1)],
      now,
      small,
    );
    expect(!almost.ok && almost.message).toContain("Try again in 1 minute.");
  });
});

describe("checkInvocationRate", () => {
  it("allows up to the limit in a minute", () => {
    expect(checkInvocationRate(1, small)).toEqual({ ok: true });
    expect(checkInvocationRate(2, small).ok).toBe(false);
  });
});

describe("describeAppAllowance", () => {
  it("states what an app is given, in the units people use", () => {
    expect(describeAppAllowance(DEFAULT_LIMITS, false)).toBe(
      "Up to 10 instances, each 1 CPU and 512 MB",
    );
    expect(describeAppAllowance(DEFAULT_LIMITS, true)).toBe(
      "Up to 10 instances, each 1 CPU and 1 GB",
    );
  });
});

describe("appMemory", () => {
  const none = { memoryMiB: null, declaredMemoryMiB: null };

  it("is the default for the app's shape when nobody said", () => {
    expect(appMemory(none, false)).toBe(512);
    expect(appMemory(none, true)).toBe(1024);
  });

  it("follows the repository, and a person's choice over that", () => {
    expect(appMemory({ memoryMiB: null, declaredMemoryMiB: 2048 }, false)).toBe(2048);
    expect(appMemory({ memoryMiB: 1024, declaredMemoryMiB: 2048 }, false)).toBe(1024);
  });

  it("never gives an app with sidecars less than their sum needed", () => {
    expect(appMemory({ memoryMiB: 512, declaredMemoryMiB: null }, true)).toBe(1024);
  });
});

describe("settleAppMemory", () => {
  it("rounds up to a size Cira offers, and says when it had to cap", () => {
    expect(settleAppMemory(700)).toEqual({ memoryMiB: 1024, capped: false });
    expect(settleAppMemory(16384)).toEqual({ memoryMiB: 4096, capped: true });
    expect(settleAppMemory(null)).toEqual({ memoryMiB: null, capped: false });
  });
});
