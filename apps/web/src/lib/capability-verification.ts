import "server-only";

import { and, eq } from "drizzle-orm";
import { apps, capabilities, db } from "@cira/db";
import { deploymentProvider } from "@cira/deploy";
import { probeWebUi } from "@/lib/browser-ui";
import { recordVerification } from "@/lib/capabilities";
import { verifyCapabilities } from "@/lib/capability-verify";
import { latestDeployment } from "@/lib/queries";

/**
 * Ask the app whether the capabilities credited to it are real.
 *
 * Reading source can be wrong; the running app cannot. Lifted out of the route
 * the CLI calls because it is not a step of deploying - it is a step of
 * finding capabilities, and finding them from the app's own page skipped it
 * entirely. Everything that turned up that way stayed unverified, which the
 * panel honestly reported as "Checking" and would have gone on reporting for
 * ever.
 */

export type VerificationOutcome =
  | {
      ok: true;
      callable: number;
      /** Served, and shut to Cira. Kept and explained rather than deleted. */
      refused: number;
      absent: number;
      inconclusive: boolean;
    }
  | { ok: false; reason: "not-running" | "unreachable" };

const SETTLED = {
  ok: true,
  callable: 0,
  refused: 0,
  absent: 0,
  inconclusive: false,
} as const;

export async function verifyAppCapabilities(appId: string): Promise<VerificationOutcome> {
  const database = db();

  // Only what has not been asked about. A redeploy sets a moved capability
  // back to pending, so this is everything new plus anything that shifted -
  // and, once, everything that was stamped under the rule 0016 replaced.
  const pending = await database
    .select({
      name: capabilities.name,
      method: capabilities.method,
      path: capabilities.path,
      risk: capabilities.risk,
      probe: capabilities.probe,
    })
    .from(capabilities)
    .where(and(eq(capabilities.appId, appId), eq(capabilities.reach, "pending")));

  const deployment = await latestDeployment(appId);
  const url = deployment !== null && deployment.status === "live" ? deployment.url : null;

  if (url === null) {
    if (pending.length === 0) {
      return SETTLED;
    }
    return { ok: false, reason: "not-running" };
  }

  let token: string;
  try {
    token = await deploymentProvider().invocationToken(url);
  } catch {
    if (pending.length === 0) {
      return SETTLED;
    }
    return { ok: false, reason: "unreachable" };
  }

  const origin = new URL(url).origin;

  // Asked on every run rather than only when capabilities changed, because
  // whether an app has a front door is a fact about the deploy and not about
  // its capabilities. Null means the app did not answer clearly enough to
  // conclude anything, and then whatever was known is left alone.
  const webUi = await probeWebUi({ origin, token });
  if (webUi !== null) {
    await database
      .update(apps)
      .set({ hasWebUi: webUi, updatedAt: new Date() })
      .where(eq(apps.id, appId));
  }

  if (pending.length === 0) return SETTLED;

  const outcome = await verifyCapabilities({
    origin,
    token,
    capabilities: pending.map((row) => ({
      name: row.name,
      method: row.method,
      path: row.path,
      risk: row.risk === "read" ? "read" : "write",
      probe: (row.probe as Record<string, unknown> | null) ?? undefined,
    })),
  });

  // Nothing is recorded when the app answers everything. Stamping capabilities
  // an app confirmed indiscriminately would be worse than leaving them off.
  if (!outcome.inconclusive) {
    await recordVerification({
      appId,
      callable: outcome.callable,
      refused: outcome.refused,
      absent: outcome.absent,
    });
  }

  return {
    ok: true,
    callable: outcome.callable.length,
    refused: outcome.refused.length,
    absent: outcome.absent.length,
    inconclusive: outcome.inconclusive,
  };
}
