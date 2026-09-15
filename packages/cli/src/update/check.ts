import { get } from "node:https";
import { currentVersion, isNewer } from "./version.js";
import { readUpdateState, writeUpdateState } from "./state.js";

/**
 * Asking the registry what the latest Cira is.
 *
 * npm is the mechanism the product already tells developers to use, so it is
 * the one the updater uses. Nothing here invents a distribution channel: if
 * the package is not on the registry, the answer is simply "no update", which
 * is the same answer being offline gives.
 */

const REGISTRY = "https://registry.npmjs.org/@cira-app%2Fcli/latest";

/** Long enough to be useful on a slow connection, short enough to abandon. */
const CHECK_TIMEOUT_MS = 2500;

/** Roughly twice a day is often enough to hear about a release. */
export const TTL_MS = 8 * 60 * 60 * 1000;

export interface UpdateCheck {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
}

export type FetchLatest = (
  signal: AbortSignal,
  options: { detached: boolean },
) => Promise<string | null>;

/**
 * The published version, or null for every kind of "could not say".
 *
 * A 404 (never published), a timeout, no network and a malformed body all
 * collapse to the same answer on purpose. The caller has nothing different to
 * do about any of them, and an updater that reports its own failures is an
 * updater that interrupts work to talk about itself.
 */
export const fetchLatestVersion: FetchLatest = (signal, { detached }) =>
  new Promise((resolve) => {
    const done = (version: string | null) => resolve(version);

    const request = get(
      REGISTRY,
      { signal, headers: { accept: "application/json" } },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          done(null);
          return;
        }

        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
          // A registry answering with something enormous is not answering the
          // question that was asked.
          if (body.length > 200_000) request.destroy();
        });
        response.on("end", () => {
          try {
            const version = (JSON.parse(body) as { version?: unknown }).version;
            done(typeof version === "string" ? version : null);
          } catch {
            done(null);
          }
        });
      },
    );

    // node:https rather than fetch, purely so the socket can be unreferenced.
    // A passive check must never be the reason a finished command is still
    // running: with fetch, the connection pool outlives the abort and a
    // `cira status` pays for a lookup nobody waited for.
    if (detached) request.on("socket", (socket) => socket.unref());

    request.setTimeout(CHECK_TIMEOUT_MS, () => request.destroy());
    request.on("error", () => done(null));
  });

/**
 * Has a newer Cira been published?
 *
 * `force` is what separates `cira update` from every other command: a passive
 * check honours the cache, and someone who typed `update` is owed a fresh
 * answer.
 */
export async function checkForUpdate(
  options: {
    force?: boolean;
    fetchLatest?: FetchLatest;
    signal?: AbortSignal;
    now?: number;
  } = {},
): Promise<UpdateCheck> {
  const current = currentVersion();
  const state = readUpdateState();
  const now = options.now ?? Date.now();

  if (options.force !== true && !expired(state.lastCheckedAt, now)) {
    const cached = state.latestVersion ?? null;
    return {
      current,
      latest: cached,
      hasUpdate: cached !== null && isNewer(cached, current),
    };
  }

  // Recorded before the request rather than after it. A passive check is
  // abandoned the moment the command finishes, so waiting until it returns
  // would mean a fast command never records having tried - and pays for a
  // lookup it abandons all over again on the next run.
  writeUpdateState({ ...state, lastCheckedAt: new Date(now).toISOString() });

  const fetchLatest = options.fetchLatest ?? fetchLatestVersion;
  const controller = new AbortController();
  options.signal?.addEventListener("abort", () => controller.abort());

  const latest = await fetchLatest(controller.signal, {
    detached: options.force !== true,
  });

  if (latest !== null) {
    writeUpdateState({
      ...readUpdateState(),
      lastCheckedAt: new Date(now).toISOString(),
      latestVersion: latest,
    });
  }

  return { current, latest, hasUpdate: latest !== null && isNewer(latest, current) };
}

function expired(lastCheckedAt: string | undefined, now: number): boolean {
  if (lastCheckedAt === undefined) return true;
  const at = Date.parse(lastCheckedAt);
  return Number.isNaN(at) || now - at >= TTL_MS;
}
