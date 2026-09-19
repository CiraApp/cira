"use server";

import { deploymentProvider } from "@cira/deploy";
import {
  LOG_RANGES,
  OLDEST_LOG_MS,
  RuntimeLogsError,
  logWindow,
  type LogRange,
  type RuntimeLogEntry,
  type RuntimeLogMinimum,
} from "@cira/core";
import { ForbiddenError, NotFoundError, requireAppManage } from "@/lib/authz";
import { latestDeployment } from "@/lib/queries";

/**
 * Runtime logs for the page that shows them.
 *
 * Only for people who manage the app. A log holds every user's requests and
 * whatever the app chose to print - how it is run, not how it is used - which
 * is the same line the environment panel draws.
 *
 * Nothing the browser sends decides which app's logs come back. It names the
 * app by its address, the same as every page; the session says who is asking;
 * and the service the query reads is taken from the app's own deployment
 * record. What the browser does choose - a time range, a level, a search - is
 * checked here and then only ever narrows that one service's lines.
 *
 * Fetched and handed straight back. Cira keeps no copy, and writes none of it
 * to its own logs.
 */

export interface RuntimeLogsRequest {
  /** One of these three says which slice of time. */
  range?: LogRange;
  /** A moment, for the logs around one console run. ISO 8601. */
  around?: string;
  /** An exact window, as a previous answer gave it, to page within. ISO 8601. */
  window?: { since: string; until: string };
  minimum?: RuntimeLogMinimum;
  search?: string;
  /** Continue backwards from a previous page. Requires `window`. */
  pageToken?: string;
  /** For Live: lines at or after this moment, oldest first. ISO 8601. */
  after?: string;
}

export type RuntimeLogsResult =
  | {
      ok: true;
      entries: RuntimeLogEntry[];
      /** Pass back, with `window`, for the page before this one. */
      nextPageToken: string | null;
      window: { since: string; until: string };
    }
  | {
      ok: false;
      reason:
        | "not-allowed"
        | "busy"
        | "unavailable"
        | "not-deployed"
        | "demo"
        | "not-cloud-run"
        | "no-access"
        | "bad-request";
      error: string;
    };

/** Two hundred lines a page: a screen or two, and cheap for Google to find. */
const PAGE = 200;

export async function fetchRuntimeLogs(
  spaceSlug: string,
  appSlug: string,
  request: RuntimeLogsRequest,
): Promise<RuntimeLogsResult> {
  let appId: string;
  try {
    appId = (await requireAppManage(spaceSlug, appSlug)).app.id;
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) {
      // One sentence for both, so this cannot be used to learn which apps exist.
      return {
        ok: false,
        reason: "no-access",
        error: "No such app, or you do not manage it.",
      };
    }
    throw error;
  }

  const now = new Date();
  const asked = readRequest(request, now);
  if (asked === null) {
    return { ok: false, reason: "bad-request", error: "That is not a range of logs." };
  }

  const deployment = await latestDeployment(appId);
  if (deployment === null) {
    return {
      ok: false,
      reason: "not-deployed",
      error: "This app has never been deployed, so it has not run to log anything.",
    };
  }
  if (deployment.provider === "demo") {
    return {
      ok: false,
      reason: "demo",
      error: "Demo apps do not run anywhere, so they have no logs.",
    };
  }
  if (deployment.provider !== "cloudrun") {
    return {
      ok: false,
      reason: "not-cloud-run",
      error:
        "This app was deployed before Cira ran apps itself. Deploy it again to see its logs.",
    };
  }

  try {
    const page = await deploymentProvider().getRuntimeLogs(
      deployment.providerDeploymentId,
      {
        since: asked.since,
        until: asked.until,
        minimum: asked.minimum,
        search: asked.search,
        order: asked.live ? "oldest" : "newest",
        pageToken: asked.pageToken,
        limit: PAGE,
      },
    );
    return {
      ok: true,
      entries: page.entries,
      nextPageToken: page.nextPageToken,
      window: { since: asked.since.toISOString(), until: asked.until.toISOString() },
    };
  } catch (error) {
    if (error instanceof RuntimeLogsError) {
      return { ok: false, reason: error.reason, error: sentenceFor(error.reason) };
    }
    return {
      ok: false,
      reason: "unavailable",
      error: "The logs could not be read right now.",
    };
  }
}

/** The words a page shows for each way Google can say no. */
function sentenceFor(reason: RuntimeLogsError["reason"]): string {
  switch (reason) {
    case "not-allowed":
      return "Cira is not allowed to read this app's logs yet. Google needs to let Cira's service account read Cloud Logging, which is one grant on the project.";
    case "busy":
      return "Google is limiting how often logs can be read. Trying again shortly.";
    case "unavailable":
      return "Google would not return the logs right now.";
  }
}

interface Asked {
  since: Date;
  until: Date;
  minimum: RuntimeLogMinimum;
  search: string | null;
  pageToken: string | null;
  live: boolean;
}

/**
 * What the browser asked for, checked, or null when it is not something a
 * page could have sent. Anything unexpected is refused rather than repaired:
 * a request that needs repairing did not come from the page.
 */
function readRequest(request: unknown, now: Date): Asked | null {
  if (typeof request !== "object" || request === null) return null;
  const r = request as Record<string, unknown>;

  const minimum = r["minimum"] ?? "all";
  if (minimum !== "all" && minimum !== "warning" && minimum !== "error") return null;

  const search = r["search"] ?? "";
  if (typeof search !== "string" || search.length > 500) return null;

  const pageToken = r["pageToken"] ?? null;
  if (pageToken !== null && (typeof pageToken !== "string" || pageToken.length > 2000)) {
    return null;
  }

  const common = {
    minimum,
    search: search.trim() === "" ? null : search,
  } as const;

  // Live: whatever arrived since the newest line the page already has.
  if (r["after"] !== undefined) {
    const after = dateOf(r["after"]);
    if (after === null || pageToken !== null) return null;
    if (
      after.getTime() > now.getTime() ||
      after.getTime() < now.getTime() - OLDEST_LOG_MS
    ) {
      return null;
    }
    return { ...common, since: after, until: now, pageToken: null, live: true };
  }

  // Paging: the exact window an earlier answer covered, because a page token
  // only means anything against the query that produced it.
  if (r["window"] !== undefined) {
    const w = r["window"] as Record<string, unknown> | null;
    const since = dateOf(w?.["since"]);
    const until = dateOf(w?.["until"]);
    if (since === null || until === null || since >= until) return null;
    if (until.getTime() - since.getTime() > LOG_RANGES["7d"] + 60_000) return null;
    if (since.getTime() < now.getTime() - OLDEST_LOG_MS) return null;
    if (until.getTime() > now.getTime() + 60_000) return null;
    return { ...common, since, until, pageToken, live: false };
  }

  if (pageToken !== null) return null;

  if (r["around"] !== undefined) {
    const at = dateOf(r["around"]);
    const window = at === null ? null : logWindow({ around: at }, now);
    return window === null
      ? null
      : { ...common, ...window, pageToken: null, live: false };
  }

  const range = r["range"] ?? "1h";
  if (typeof range !== "string" || !Object.hasOwn(LOG_RANGES, range)) return null;
  const window = logWindow({ range: range as LogRange }, now);
  return window === null ? null : { ...common, ...window, pageToken: null, live: false };
}

function dateOf(value: unknown): Date | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
