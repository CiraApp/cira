/**
 * When not answering becomes an outage, and when an outage is over.
 *
 * Plain values in and out, so the rules can be read and tested apart from
 * the checks. One missed answer is a blip - a cold start that ran long, a
 * deploy switching over - and is not worth waking anyone for; the threshold
 * of checks in a row is what turns it into news. Only the edges are events:
 * the check that crosses the threshold, and the first one that answers after
 * it. Everything in between is quiet, however long it lasts.
 */

export interface Watched {
  /** Checks in a row that found it not answering. */
  failures: number;
  /** When the first of those checks ran; null while it is fine. */
  downSince: Date | null;
}

export type WatchEvent =
  { kind: "down"; since: Date } | { kind: "back"; since: Date } | null;

export function nextWatch(
  previous: Watched | null,
  answering: boolean,
  now: Date,
  /** Checks in a row before it counts: 2 for a web address, 1 for a worker. */
  threshold: number,
): { watched: Watched; event: WatchEvent } {
  const before = previous ?? { failures: 0, downSince: null };

  if (answering) {
    const wasDown = before.failures >= threshold && before.downSince !== null;
    return {
      watched: { failures: 0, downSince: null },
      event: wasDown ? { kind: "back", since: before.downSince! } : null,
    };
  }

  const failures = before.failures + 1;
  const downSince = before.downSince ?? now;
  return {
    watched: { failures, downSince },
    event: failures === threshold ? { kind: "down", since: downSince } : null,
  };
}

/** How long ago a failed scheduled run may have finished and still be news. */
export const RUN_FAILURE_WINDOW_MS = 6 * 3600_000;

/** How recently a worker must have run out of memory to count as failing now. */
export const WORKER_MEMORY_WINDOW_MS = 15 * 60_000;
