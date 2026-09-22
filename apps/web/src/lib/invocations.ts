import "server-only";

import { desc, eq } from "drizzle-orm";
import { db, invocations, users } from "@cira/db";

/** One run, as an app's page lists it. */
export interface RunRecord {
  id: string;
  capabilityName: string;
  personName: string;
  via: "mcp" | "ask" | "console";
  outcome: "ran" | "refused" | "pending" | "disabled" | "invalid-input" | "unreachable";
  status: number | null;
  elapsedMs: number | null;
  /** Its person approved it in Cira first: a write an assistant asked for. */
  approved: boolean;
  at: Date;
}

/**
 * The most recent runs of an app's capabilities, newest first.
 *
 * The caller has already established that the person manages the app: this
 * says who used it and how, which is how the app is run rather than how it is
 * used, and so the same line the environment panel and runtime logs draw.
 */
export async function recentRuns(appId: string, limit = 50): Promise<RunRecord[]> {
  const rows = await db()
    .select({ run: invocations, name: users.name })
    .from(invocations)
    .innerJoin(users, eq(users.id, invocations.userId))
    .where(eq(invocations.appId, appId))
    .orderBy(desc(invocations.createdAt))
    .limit(limit);

  return rows.map(({ run, name }) => ({
    id: run.id,
    capabilityName: run.capabilityName,
    personName: name,
    via: run.via,
    outcome: run.outcome,
    status: run.status,
    elapsedMs: run.elapsedMs,
    approved: run.approvalId !== null,
    at: run.createdAt,
  }));
}
