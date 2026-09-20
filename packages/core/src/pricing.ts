/**
 * What running a company's software costs Cira, in one place.
 *
 * Cira runs every company's apps in one Google project, on one bill. Until
 * each company's share of that bill can be seen, a plan is a guess and a
 * customer who costs more than they pay is invisible. These are the rates
 * that turn what Google reports - instance-seconds and requests - into
 * dollars, and they are here rather than in the page or the provider because
 * the same numbers price a plan, warn beside a worker's switch, and add up a
 * month.
 *
 * They are Cloud Run's published us-central1 rates for instance-based
 * billing, and they are an estimate: no tax, no committed-use discount, no
 * free tier. Estimating slightly high is the safe direction for deciding what
 * to charge.
 */

export interface RateCard {
  /** Dollars per vCPU-second of instance time. */
  vCpuSecond: number;
  /** Dollars per GiB-second of memory. */
  gibSecond: number;
  /** Dollars per million requests. */
  requestMillion: number;
  /** Dollars per minute of build time, on the machine type Cira builds with. */
  buildMinute: number;
}

export const CLOUD_RUN_RATES: RateCard = {
  vCpuSecond: 0.000018,
  gibSecond: 0.000002,
  requestMillion: 0.4,
  buildMinute: 0.003,
};

/** Instance time, with what each instance was given while it ran. */
export interface ComputeUse {
  instanceSeconds: number;
  cpu: number;
  memoryMiB: number;
}

/** What that instance time cost, in dollars. */
export function computeCost(use: ComputeUse, rates: RateCard = CLOUD_RUN_RATES): number {
  const perSecond = use.cpu * rates.vCpuSecond + (use.memoryMiB / 1024) * rates.gibSecond;
  return Math.max(0, use.instanceSeconds) * perSecond;
}

export function requestCost(requests: number, rates: RateCard = CLOUD_RUN_RATES): number {
  return (Math.max(0, requests) / 1_000_000) * rates.requestMillion;
}

/** Thirty days of one instance that never scales down: what a worker costs. */
export function monthlyCost(
  use: Omit<ComputeUse, "instanceSeconds">,
  rates: RateCard = CLOUD_RUN_RATES,
): number {
  return computeCost({ ...use, instanceSeconds: 30 * 24 * 3600 }, rates);
}

/**
 * Money as a page says it. Small amounts are what a month of a quiet app
 * costs, and rounding them to whole dollars would report every app as free;
 * large ones are decisions, and cents in them are noise.
 */
export function describeDollars(dollars: number): string {
  if (dollars <= 0) return "$0";
  if (dollars < 0.01) return "under a cent";
  // A price is usually a whole number of dollars, and "$60.0" reads like a
  // measurement rather than a price.
  if (Number.isInteger(dollars)) return `$${dollars}`;
  if (dollars < 100) return `$${dollars.toFixed(2)}`;
  return `$${Math.round(dollars)}`;
}

/** Instance time as a page says it: the unit a person can picture. */
export function describeInstanceTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const hours = seconds / 3600;
  return hours < 100 ? `${hours.toFixed(1)} h` : `${Math.round(hours)} h`;
}
