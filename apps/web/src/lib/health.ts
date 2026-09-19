import "server-only";

import { sql } from "drizzle-orm";
import type { Database } from "@cira/db";

/**
 * Whether Cira is up, for an uptime monitor to ask every minute.
 *
 * Answers only yes or no and which part failed - nothing about any company,
 * since anyone can ask. Each check is held to a few seconds, so a part that
 * hangs reads as down rather than as a monitor that never hears back.
 */

const PATIENCE_MS = 5_000;

export type HealthVerdict = { ok: true } | { ok: false; failing: string };

/** The database answers a trivial query. */
export async function checkDatabase(database: Database): Promise<HealthVerdict> {
  try {
    await within(database.execute(sql`select 1`));
    return { ok: true };
  } catch {
    return { ok: false, failing: "database" };
  }
}

/**
 * The app proxy answers, as itself. Asked for an app that does not exist
 * without a session, it says "Not signed in" with a 401 before looking
 * anything up - so that answer, and only that answer, means the Worker is
 * running. A 5xx, a timeout or Cloudflare's own error page all mean it is not.
 */
export async function checkProxy(
  appsDomain: string,
  fetchImpl: typeof fetch = fetch,
): Promise<HealthVerdict> {
  try {
    const response = await within(
      fetchImpl(`https://health--check.${appsDomain}/`, {
        headers: { accept: "text/plain" },
        redirect: "manual",
        cache: "no-store",
      }),
    );
    const body = await response.text();
    return response.status === 401 && body.trim() === "Not signed in"
      ? { ok: true }
      : { ok: false, failing: "app proxy" };
  } catch {
    return { ok: false, failing: "app proxy" };
  }
}

function within<T>(work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timed out")), PATIENCE_MS),
    ),
  ]);
}

/** The answer a monitor reads: 200 when up, 503 when not, never cached. */
export function healthResponse(verdict: HealthVerdict): Response {
  return Response.json(verdict, {
    status: verdict.ok ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
