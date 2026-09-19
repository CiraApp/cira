import { describe, expect, it } from "vitest";
import { monthlyBill, PLANS, planOf, workerCost, describePlan } from "./plans.js";

/**
 * What a company pays, against what it costs Cira to serve them. The one
 * number that must never invert is the worker: it is the only thing a
 * customer can leave running that costs real money every hour.
 */
describe("plans", () => {
  it("bills per person, never below the minimum", () => {
    const team = PLANS.team;
    expect(monthlyBill(team, { seats: 20, workers: 0 })).toEqual({
      seats: 20,
      seatDollars: 240,
      workerDollars: 0,
      dollars: 240,
    });
    // A two-person pilot pays the floor, not $24.
    expect(monthlyBill(team, { seats: 2, workers: 0 }).dollars).toBe(60);
  });

  it("charges more for a worker than a worker costs", () => {
    const team = PLANS.team;
    const bill = monthlyBill(team, { seats: 10, workers: 2 });
    expect(bill.workerDollars).toBe(150);
    expect(bill.dollars).toBe(270);
    // Two always-on workers with the default memory cost Cira about $104.
    expect(workerCost(2, 1024)).toBeLessThan(bill.workerDollars);
  });

  it("lets a trial run one worker, free, and says so", () => {
    const trial = PLANS.trial;
    expect(trial.limits.processes.workersPerSpace).toBe(1);
    expect(monthlyBill(trial, { seats: 30, workers: 1 }).dollars).toBe(0);
    expect(describePlan(trial)).toBe("Free for 14 days, with 1 worker");
    expect(describePlan(PLANS.team)).toContain("$12 per person a month");
  });

  it("reads an unknown or missing plan as the trial, never as a paid one", () => {
    expect(planOf(null).id).toBe("trial");
    expect(planOf("enterprise-2030").id).toBe("trial");
    expect(planOf("team").id).toBe("team");
  });
});
