import type { GoogleTokens } from "./auth.js";
import type { CloudRunConfig } from "./config.js";

/**
 * How much of Google a company actually used.
 *
 * Google bills the whole project to Cira, so the only way to tell one
 * company's share from another's is to ask what each thing ran for. Cloud
 * Monitoring answers that per resource, in instance-seconds, which is the
 * same unit Cloud Run bills in; what each instance was given - its CPU and
 * memory - Cira already knows, and pricing.ts turns the two into money.
 *
 * Read when somebody opens the page, like everything else here. Monitoring
 * keeps these metrics for six weeks, which covers a month's bill.
 */

const MONITORING_API = "https://monitoring.googleapis.com/v3";

/** The three shapes a Cloud Run thing comes in, and what names them. */
const RESOURCES = {
  service: { type: "cloud_run_revision", label: "service_name" },
  job: { type: "cloud_run_job", label: "job_name" },
  "worker-pool": { type: "cloud_run_worker_pool", label: "worker_pool_name" },
} as const;

export type UsageKind = keyof typeof RESOURCES;

/** Instance time and requests, by the provider's own name for the thing. */
export interface UsageTotals {
  instanceSeconds: Map<string, number>;
  requests: Map<string, number>;
}

export class UsageUnavailableError extends Error {
  constructor(readonly reason: "not-allowed" | "disabled" | "unavailable") {
    super("Usage could not be read.");
    this.name = "UsageUnavailableError";
  }
}

/** One query: this metric, summed over the window, one row per thing. */
export function usageQuery(args: {
  metric: string;
  kind: UsageKind;
  since: Date;
  until: Date;
}): Record<string, string> {
  const { type, label } = RESOURCES[args.kind];
  const seconds = Math.max(
    60,
    Math.round((args.until.getTime() - args.since.getTime()) / 1000),
  );
  return {
    filter: `metric.type="${args.metric}" AND resource.type="${type}"`,
    "interval.startTime": args.since.toISOString(),
    "interval.endTime": args.until.toISOString(),
    "aggregation.alignmentPeriod": `${seconds}s`,
    "aggregation.perSeriesAligner": "ALIGN_SUM",
    "aggregation.crossSeriesReducer": "REDUCE_SUM",
    "aggregation.groupByFields": `resource.label.${label}`,
  };
}

interface TimeSeriesResponse {
  timeSeries?: Array<{
    resource?: { labels?: Record<string, string> };
    points?: Array<{ value?: { doubleValue?: number; int64Value?: string } }>;
  }>;
}

/** What each thing in the answer used, by name. */
export function readSeries(
  body: TimeSeriesResponse,
  kind: UsageKind,
): Map<string, number> {
  const { label } = RESOURCES[kind];
  const totals = new Map<string, number>();
  for (const series of body.timeSeries ?? []) {
    const name = series.resource?.labels?.[label];
    if (name === undefined) continue;
    const sum = (series.points ?? []).reduce((total, point) => {
      const value = point.value ?? {};
      return total + (value.doubleValue ?? Number(value.int64Value ?? 0));
    }, 0);
    totals.set(name, (totals.get(name) ?? 0) + sum);
  }
  return totals;
}

export class CloudRunUsage {
  constructor(
    private readonly config: CloudRunConfig,
    private readonly tokens: GoogleTokens,
  ) {}

  /**
   * Instance time for every Cloud Run thing in the project, and requests for
   * its services. Whose is whose is decided by the caller, from Cira's own
   * records; Google is only asked what ran.
   */
  async read(since: Date, until: Date): Promise<UsageTotals> {
    const instanceSeconds = new Map<string, number>();
    for (const kind of ["service", "job", "worker-pool"] as const) {
      const body = await this.ask(
        usageQuery({
          metric: "run.googleapis.com/container/billable_instance_time",
          kind,
          since,
          until,
        }),
      );
      for (const [name, seconds] of readSeries(body, kind)) {
        instanceSeconds.set(name, (instanceSeconds.get(name) ?? 0) + seconds);
      }
    }

    const requests = readSeries(
      await this.ask(
        usageQuery({
          metric: "run.googleapis.com/request_count",
          kind: "service",
          since,
          until,
        }),
      ),
      "service",
    );

    return { instanceSeconds, requests };
  }

  private async ask(query: Record<string, string>): Promise<TimeSeriesResponse> {
    const access = await this.tokens.accessToken();
    const url = new URL(`${MONITORING_API}/projects/${this.config.projectId}/timeSeries`);
    for (const [key, value] of Object.entries(query)) url.searchParams.append(key, value);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { authorization: `Bearer ${access}` },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new UsageUnavailableError("unavailable");
    }

    if (!response.ok) {
      // Google's words name the project and the account; its status is what a
      // page can act on.
      const body = await response.text();
      if (body.includes("SERVICE_DISABLED")) throw new UsageUnavailableError("disabled");
      if (response.status === 403 || response.status === 401) {
        throw new UsageUnavailableError("not-allowed");
      }
      throw new UsageUnavailableError("unavailable");
    }

    return (await response.json()) as TimeSeriesResponse;
  }
}
