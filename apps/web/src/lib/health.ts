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

/** How far ahead a drill may be set to end. Anything later is ignored. */
export const DRILL_LIMIT_MS = 60 * 60_000;

/**
 * Down on purpose, for a drill: until the moment `CIRA_HEALTH_DRILL_UNTIL`
 * names, this check fails, so the monitor sees an outage and whoever is on
 * call should hear about it - which is the thing being tested, since a
 * monitor nobody has seen alert is a monitor nobody knows works.
 *
 * It ends itself. The variable names when the drill stops rather than
 * whether one is on, so nobody has to remember to turn it off, and a moment
 * more than an hour away is ignored: a typo cannot leave Cira reporting
 * itself down, which would hide a real outage behind a pretend one.
 */
export function checkDrill(
  until: string | undefined,
  now: number = Date.now(),
): HealthVerdict {
  const end = Date.parse(until ?? "");
  const running = Number.isFinite(end) && end > now && end - now <= DRILL_LIMIT_MS;
  return running ? { ok: false, failing: "drill" } : { ok: true };
}

function within<T>(work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timed out")), PATIENCE_MS),
    ),
  ]);
}

/**
 * Several checks as one answer: up only if every part is, and naming each
 * part that is not. One monitor watches all of Cira this way, and its alert
 * says which part broke, since the monitor keeps the body of a failed check.
 */
export function combine(verdicts: readonly HealthVerdict[]): HealthVerdict {
  const failing = verdicts.flatMap((v) => (v.ok ? [] : [v.failing]));
  return failing.length === 0 ? { ok: true } : { ok: false, failing: failing.join(", ") };
}

/** The answer a monitor reads: 200 when up, 503 when not, never cached. */
export function healthResponse(verdict: HealthVerdict): Response {
  return Response.json(verdict, {
    status: verdict.ok ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
