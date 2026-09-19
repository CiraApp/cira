import { DEFAULT_LIMITS, type Limits } from "./limits.js";
import { monthlyCost } from "./pricing.js";

/**
 * What Cira charges, in terms of what it costs to run (pricing.ts) and what a
 * plan allows (limits.ts).
 *
 * These are placeholders, set from Cira's own measured costs rather than from
 * a market: an app that scales to zero costs cents a month, a worker that
 * never scales down costs about fifty dollars, and the fixed bill - Vercel,
 * Neon, Clerk, Sentry - is tens of dollars whatever anyone deploys. So the
 * price is per person, which is where the value is, and a worker is charged
 * for separately, because it is the one thing a customer can switch on that
 * costs real money every hour.
 *
 * They live here, beside the limits, because the same two numbers decide what
 * a page promises, what a plan allows and what an invoice says. Changing a
 * price is changing this record.
 */

export type PlanId = "trial" | "team";

export interface Plan {
  id: PlanId;
  name: string;
  /** Dollars per person per month. Zero while trying it. */
  perSeatMonthly: number;
  /** The smallest number of seats billed, so a two-person pilot is worth serving. */
  minimumSeats: number;
  /** Dollars a month for each worker switched on, over what the plan includes. */
  workerMonthly: number;
  includedWorkers: number;
  /** Days before a trial has to become a plan. Zero for a paid plan. */
  trialDays: number;
  /** What it allows. One record, so a page cannot promise what the server refuses. */
  limits: Limits;
}

/**
 * A trial allows one worker: enough to try the thing that separates Cira from
 * a deploy button, not enough to run a company's queue on for free.
 */
const TRIAL_LIMITS: Limits = {
  ...DEFAULT_LIMITS,
  processes: { ...DEFAULT_LIMITS.processes, workersPerSpace: 1 },
};

export const PLANS: Record<PlanId, Plan> = {
  trial: {
    id: "trial",
    name: "Trial",
    perSeatMonthly: 0,
    minimumSeats: 0,
    workerMonthly: 0,
    includedWorkers: 1,
    trialDays: 14,
    limits: TRIAL_LIMITS,
  },
  team: {
    id: "team",
    name: "Team",
    perSeatMonthly: 12,
    minimumSeats: 5,
    // Above what a worker costs Cira - about $52 a month - so that the one
    // thing a customer can leave running never loses money.
    workerMonthly: 75,
    includedWorkers: 0,
    trialDays: 0,
    limits: DEFAULT_LIMITS,
  },
};

export const DEFAULT_PLAN: PlanId = "trial";

export function planOf(id: string | null | undefined): Plan {
  return PLANS[(id ?? DEFAULT_PLAN) as PlanId] ?? PLANS[DEFAULT_PLAN];
}

export interface BillableUse {
  /** People in the space. Everyone who can sign in is a seat. */
  seats: number;
  /** Workers switched on. Scheduled runs are not charged for; they end. */
  workers: number;
}

export interface Bill {
  seats: number;
  seatDollars: number;
  workerDollars: number;
  dollars: number;
}

/** What a company would pay for a month of this, at this plan. */
export function monthlyBill(plan: Plan, use: BillableUse): Bill {
  const seats = Math.max(plan.minimumSeats, Math.max(0, Math.trunc(use.seats)));
  const seatDollars = seats * plan.perSeatMonthly;
  const extraWorkers = Math.max(0, Math.trunc(use.workers) - plan.includedWorkers);
  const workerDollars = extraWorkers * plan.workerMonthly;
  return { seats, seatDollars, workerDollars, dollars: seatDollars + workerDollars };
}

/**
 * What a month of those workers costs Cira, for comparing a bill against the
 * bill behind it. Compute for apps that scale to zero is pennies beside this.
 */
export function workerCost(workers: number, memoryMiB: number): number {
  return Math.max(0, workers) * monthlyCost({ cpu: DEFAULT_LIMITS.app.cpu, memoryMiB });
}

/** A plan in the words a page uses. */
export function describePlan(plan: Plan): string {
  if (plan.perSeatMonthly === 0) {
    return `Free for ${plan.trialDays} days, with ${plan.includedWorkers} worker`;
  }
  return `$${plan.perSeatMonthly} per person a month, ${plan.minimumSeats} people minimum, plus $${plan.workerMonthly} a month for each worker`;
}
