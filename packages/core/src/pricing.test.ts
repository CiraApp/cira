import { describe, expect, it } from "vitest";
import {
  computeCost,
  describeDollars,
  describeInstanceTime,
  monthlyCost,
  requestCost,
} from "./pricing.js";

/** What Cira thinks running something costs, which is what a plan has to cover. */
describe("pricing", () => {
  it("prices instance time by what the instance was given", () => {
    const hour = 3600;
    // One vCPU-hour plus one GiB-hour, at the published rates.
    expect(computeCost({ instanceSeconds: hour, cpu: 1, memoryMiB: 1024 })).toBeCloseTo(
      hour * 0.00002,
      6,
    );
    // Twice the memory costs more, but far from twice as much: the CPU dominates.
    const small = computeCost({ instanceSeconds: hour, cpu: 1, memoryMiB: 512 });
    const large = computeCost({ instanceSeconds: hour, cpu: 1, memoryMiB: 2048 });
    expect(large / small).toBeCloseTo(1.16, 1);
    expect(computeCost({ instanceSeconds: 0, cpu: 1, memoryMiB: 512 })).toBe(0);
  });

  it("prices a month of never scaling down, which is what a worker does", () => {
    expect(monthlyCost({ cpu: 1, memoryMiB: 1024 })).toBeCloseTo(51.8, 1);
    expect(monthlyCost({ cpu: 1, memoryMiB: 4096 })).toBeCloseTo(67.4, 1);
  });

  it("prices requests by the million, which rounds to nothing for one app", () => {
    expect(requestCost(1_000_000)).toBeCloseTo(0.4, 6);
    expect(requestCost(1_000)).toBeCloseTo(0.0004, 6);
  });

  it("says money and time the way a page does", () => {
    expect(describeDollars(0)).toBe("$0");
    expect(describeDollars(0.004)).toBe("under a cent");
    expect(describeDollars(0.62)).toBe("$0.62");
    expect(describeDollars(18.42)).toBe("$18.42");
    // A plan's price is a price, not a measurement.
    expect(describeDollars(60)).toBe("$60");
    expect(describeDollars(412.6)).toBe("$413");
    expect(describeInstanceTime(42)).toBe("42 s");
    expect(describeInstanceTime(3600 * 8.72)).toBe("8.7 h");
  });
});
