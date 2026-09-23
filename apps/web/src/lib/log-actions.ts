"use server";

import { and, eq } from "drizzle-orm";
import { db, deployments } from "@cira/db";
import type { Deployment } from "@cira/core";
import { deployOutput } from "@/lib/deploy-output";
import { requireAppAccess } from "@/lib/authz";

export type LogsResult =
  | {
      ok: true;
      /** Which step's output this is: whichever the deploy stopped at. */
      step: "build" | "release" | "start";
      lines: Array<{ time: string; message: string }>;
    }
  | { ok: false; error: string };

/**
 * The build output for one deploy.
 *
 * Fetched on demand rather than with the page, because most visits to an app
 * are someone opening it, not someone debugging it, and logs cost a call to
 * the provider every time.
 */
export async function fetchBuildLogs(
  spaceSlug: string,
  appSlug: string,
  deploymentId: string,
): Promise<LogsResult> {
  const { app } = await requireAppAccess(spaceSlug, appSlug);

  // Scoped to this app, so a deployment id from elsewhere reveals nothing.
  const [row] = await db()
    .select()
    .from(deployments)
    .where(and(eq(deployments.id, deploymentId), eq(deployments.appId, app.id)))
    .limit(1);

  if (row === undefined) return { ok: false, error: "No such deploy." };

  try {
    const { step, lines } = await deployOutput(row as Deployment);
    if (lines.length === 0) {
      return { ok: false, error: "The provider kept no logs for this deploy." };
    }
    return {
      ok: true,
      step,
      lines: lines.map((l) => ({
        time: l.timestamp.toISOString(),
        message: l.message,
      })),
    };
  } catch {
    return { ok: false, error: "Could not reach the provider for logs." };
  }
}
