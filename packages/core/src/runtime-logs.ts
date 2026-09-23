/**
 * Runtime logs: what an app printed while it ran, and every request that
 * reached it.
 *
 * Read from the deployment provider when somebody looks, and kept nowhere.
 * These are the shapes the provider answers in and the rules for which slice
 * of time a request means, as plain values, so the page and the server cannot
 * disagree about what "the last hour" or "around this run" covers.
 */

/** Coarser than any provider's grades, and all a person scanning for trouble needs. */
export type RuntimeLogLevel = "default" | "debug" | "info" | "warning" | "error";

/** Which levels to show: everything, or only what is at least this bad. */
export type RuntimeLogMinimum = "all" | "warning" | "error";

export interface RuntimeLogRequest {
  method: string;
  /** Path and query, without the origin: the host is always the app's own. */
  path: string;
  status: number | null;
  latencyMs: number | null;
}

export interface RuntimeLogEntry {
  /** Unique within the provider, so a line fetched twice is shown once. */
  id: string;
  timestamp: Date;
  level: RuntimeLogLevel;
  /** The line as the app wrote it. Empty for a request line, which has `request`. */
  message: string;
  /** Set when `message` was cut short; the full record is in `detail`. */
  truncated: boolean;
  request: RuntimeLogRequest | null;
  /** Which container wrote it, when the app has more than one. */
  container: string | null;
  /** Everything the provider recorded for the line, as JSON, for whoever opens it. */
  detail: string;
}

export interface RuntimeLogPage {
  entries: RuntimeLogEntry[];
  /** Pass back to continue in the same direction; null when there is no more. */
  nextPageToken: string | null;
}

export interface RuntimeLogQuery {
  since: Date;
  until: Date;
  minimum: RuntimeLogMinimum;
  /** Matched as a substring of the message or the request path. */
  search: string | null;
  /**
   * `newest` pages backwards from `until`, which is how a page is opened and
   * how "Load earlier" continues. `oldest` reads forwards from `since`, which
   * is how Live asks for what arrived after the last line it has.
   */
  order: "newest" | "oldest";
  pageToken: string | null;
  limit: number;
  /**
   * Which of the app's processes to read: its web service, or one worker or
   * scheduled run by name. Absent means the web service.
   */
  process?: { kind: "worker" | "scheduled"; name: string } | undefined;
  /**
   * One version of the web service, by the provider's name for it. For what a
   * version that never started printed, without the requests the version
   * still serving was answering at the same time.
   */
  revision?: string | undefined;
}

/**
 * Why logs could not be read, in terms a page can act on.
 *
 * `not-allowed` is the provider refusing Cira itself - a missing grant, and
 * the same for every app. `disabled` is the provider's logging service being
 * switched off for the whole project, which looks the same from outside and is
 * fixed somewhere else. `busy` is a rate limit, and passes. `unavailable` is
 * anything else.
 *
 * `code` is the provider's own name for what went wrong, for whoever operates
 * Cira. It is never shown on a page.
 */
export class RuntimeLogsError extends Error {
  constructor(
    message: string,
    readonly reason: "not-allowed" | "disabled" | "busy" | "unavailable",
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "RuntimeLogsError";
  }
}

/** The ranges a page offers, and how far back each reaches. */
export const LOG_RANGES = {
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
} as const;

export type LogRange = keyof typeof LOG_RANGES;

/** Either side of a moment, for "the logs from this run". */
export const AROUND_MS = 60_000;

/**
 * Providers keep runtime logs for about a month. A request further back than
 * this is refused rather than sent, since it could only come back empty.
 */
export const OLDEST_LOG_MS = 30 * 24 * 60 * 60_000;

/**
 * The slice of time a request for logs means.
 *
 * A named range ends now. A moment - a console run - is the minute either side
 * of it, so the cause and the aftermath are both on screen, and is refused
 * when it is in the future or older than any provider keeps.
 */
export function logWindow(
  spec: { range: LogRange } | { around: Date },
  now: Date,
): { since: Date; until: Date } | null {
  if ("range" in spec) {
    const span = LOG_RANGES[spec.range];
    if (span === undefined) return null;
    return { since: new Date(now.getTime() - span), until: now };
  }

  const at = spec.around.getTime();
  if (!Number.isFinite(at)) return null;
  if (at > now.getTime() + AROUND_MS) return null;
  if (at < now.getTime() - OLDEST_LOG_MS) return null;

  return {
    since: new Date(at - AROUND_MS),
    until: new Date(Math.min(at + AROUND_MS, now.getTime())),
  };
}

/**
 * Google's own records of changing a resource - "google.cloud.run.v2.Jobs.UpdateJob",
 * "/WorkerPools.UpdateWorkerPool: Ready condition status changed..." - which
 * share a process's log with what the process printed, and say nothing about
 * why it failed. What the platform says about the container itself ("Container
 * called exit(1).") is kept: that is often the reason.
 */
export function isProviderRecord(message: string): boolean {
  return /^google\.cloud\.[\w.]+$|^\/(Jobs|WorkerPools|Services)\.\w+:/.test(message);
}
