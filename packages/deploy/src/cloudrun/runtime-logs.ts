import type {
  RuntimeLogEntry,
  RuntimeLogLevel,
  RuntimeLogMinimum,
  RuntimeLogRequest,
} from "@cira/core";

/**
 * Cloud Run's runtime logs, as Cloud Logging holds them.
 *
 * Two jobs, both pure: writing the query that reads one app's lines and
 * nothing else, and turning what comes back into one readable line each. Kept
 * apart from the provider so both can be tested without Google - the first
 * one especially, because a query that could be widened from outside would
 * be a way to read every app's logs.
 */

/** Longest message kept whole. The rest of it stays in `detail`. */
export const MAX_MESSAGE = 16_000;

/** Longest `detail` sent to a page. A record bigger than this is not being read. */
const MAX_DETAIL = 64_000;

/** Longest search sent to Google. Nobody searches logs with a paragraph. */
const MAX_SEARCH = 200;

/** Cloud Run's rules for a service name, and a region's shape. */
const SERVICE_NAME = /^[a-z][a-z0-9-]{0,62}$/;
const REGION = /^[a-z0-9-]{1,40}$/;

/**
 * The Cloud Logging filter for one service's lines in one slice of time.
 *
 * The service and region come from the deployment record, and are checked
 * against the shape Google allows anyway, so a malformed one fails here rather
 * than becoming part of a query. The only text from a person is the search,
 * and it goes inside a quoted string with its quotes and backslashes escaped
 * and its control characters removed: whatever is typed, it can only ever be
 * a string to look for, never more of the query.
 */
export function runtimeLogFilter(args: {
  service: string;
  region: string;
  since: Date;
  until: Date;
  minimum: RuntimeLogMinimum;
  search: string | null;
  /**
   * Which of the app's processes: its web service (the default), or one of
   * its scheduled runs or workers by its name on Google. Each logs under its
   * own resource type, which is what keeps them apart.
   */
  target?: { type: "job" | "worker-pool"; name: string };
}): string {
  if (!SERVICE_NAME.test(args.service)) throw new Error("Not a Cloud Run service name.");
  if (!REGION.test(args.region)) throw new Error("Not a Cloud Run region.");
  if (args.target !== undefined && !SERVICE_NAME.test(args.target.name)) {
    throw new Error("Not a Cloud Run name.");
  }

  const resource =
    args.target === undefined
      ? [
          'resource.type = "cloud_run_revision"',
          `resource.labels.service_name = "${args.service}"`,
        ]
      : args.target.type === "job"
        ? [
            'resource.type = "cloud_run_job"',
            `resource.labels.job_name = "${args.target.name}"`,
          ]
        : [
            'resource.type = "cloud_run_worker_pool"',
            `resource.labels.worker_pool_name = "${args.target.name}"`,
          ];

  const clauses = [
    ...resource,
    `resource.labels.location = "${args.region}"`,
    `timestamp >= "${args.since.toISOString()}"`,
    `timestamp <= "${args.until.toISOString()}"`,
  ];

  if (args.minimum === "warning") clauses.push("severity >= WARNING");
  if (args.minimum === "error") clauses.push("severity >= ERROR");

  // Nothing to look for is no clause at all, rather than a match for
  // everything that costs Google a scan.
  const search = args.search === null ? '""' : quoted(args.search);
  if (search !== '""') {
    // `:` is Cloud Logging's "has": a case-insensitive substring match.
    clauses.push(
      `(textPayload : ${search} OR jsonPayload.message : ${search} OR httpRequest.requestUrl : ${search})`,
    );
  }

  return clauses.join(" AND ");
}

/**
 * Text as a Cloud Logging string literal. Control characters go first -
 * nothing a person types into a search box needs a newline - then the two
 * characters that could end the string early.
 */
export function quoted(text: string): string {
  const clean = [...withoutControls(text).trim()].slice(0, MAX_SEARCH).join("");
  return `"${clean.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Every control character as a space. */
export function withoutControls(text: string): string {
  return [...text]
    .map((c) => {
      const code = c.charCodeAt(0);
      return code < 0x20 || code === 0x7f ? " " : c;
    })
    .join("");
}

/** The parts of a Cloud Logging entry this reads. Anything else is left in `detail`. */
export interface GoogleLogEntry {
  insertId?: string;
  timestamp?: string;
  receiveTimestamp?: string;
  severity?: string;
  logName?: string;
  textPayload?: string;
  jsonPayload?: Record<string, unknown>;
  protoPayload?: Record<string, unknown>;
  httpRequest?: {
    requestMethod?: string;
    requestUrl?: string;
    status?: number;
    latency?: string;
  };
  labels?: Record<string, string>;
}

/** One entry from Google as one line on the page. */
export function toRuntimeLogEntry(entry: GoogleLogEntry): RuntimeLogEntry {
  const request = requestOf(entry);
  const text = request === null ? messageOf(entry) : "";
  const truncated = text.length > MAX_MESSAGE;
  const detail = JSON.stringify(entry, null, 2);

  return {
    id: entry.insertId ?? `${entry.timestamp ?? ""}:${entry.logName ?? ""}`,
    timestamp: new Date(entry.timestamp ?? entry.receiveTimestamp ?? 0),
    level: levelOf(entry.severity),
    message: truncated ? text.slice(0, MAX_MESSAGE) : text,
    truncated,
    request,
    container: entry.labels?.["container_name"] ?? null,
    detail:
      detail.length > MAX_DETAIL
        ? `${detail.slice(0, MAX_DETAIL)}\n... cut at ${MAX_DETAIL} characters`
        : detail,
  };
}

/**
 * Google's nine grades, as the five a page shows. NOTICE is information that
 * wants attention; everything above ERROR is an error that wants it more, and
 * a page that drew four shades of red would not say anything a person acts on
 * differently.
 */
function levelOf(severity: string | undefined): RuntimeLogLevel {
  switch (severity) {
    case "DEBUG":
      return "debug";
    case "INFO":
    case "NOTICE":
      return "info";
    case "WARNING":
      return "warning";
    case "ERROR":
    case "CRITICAL":
    case "ALERT":
    case "EMERGENCY":
      return "error";
    default:
      return "default";
  }
}

/** A request line, when the entry is Cloud Run's record of one. */
function requestOf(entry: GoogleLogEntry): RuntimeLogRequest | null {
  const http = entry.httpRequest;
  if (http === undefined || http.requestMethod === undefined) return null;

  return {
    method: http.requestMethod,
    path: pathOf(http.requestUrl ?? ""),
    status: typeof http.status === "number" ? http.status : null,
    latencyMs: latencyOf(http.latency),
  };
}

/** Path and query, without the host: every request here went to the app's own. */
function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

/** `"0.012345s"`, as whole milliseconds. */
function latencyOf(latency: string | undefined): number | null {
  if (latency === undefined) return null;
  const seconds = Number(latency.replace(/s$/, ""));
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
}

/**
 * The line as the app meant it.
 *
 * Text is the common case. A structured log is read the way Cloud Logging's
 * own viewer reads one - its `message` field, then the usual alternatives -
 * and shown whole as JSON when it has none of them. An audit record says what
 * was done, since it has no message of its own.
 */
function messageOf(entry: GoogleLogEntry): string {
  if (typeof entry.textPayload === "string") return entry.textPayload.replace(/\n+$/, "");

  const json = entry.jsonPayload;
  if (json !== undefined) {
    for (const key of ["message", "msg", "error", "err"]) {
      const value = json[key];
      if (typeof value === "string" && value !== "") return value.replace(/\n+$/, "");
    }
    return JSON.stringify(json);
  }

  const proto = entry.protoPayload;
  if (proto !== undefined) {
    const method = proto["methodName"];
    const status = proto["status"] as { message?: unknown } | undefined;
    const said = typeof status?.message === "string" ? `: ${status.message}` : "";
    if (typeof method === "string") return `${method}${said}`;
  }

  return "";
}
