import "server-only";

import { eq } from "drizzle-orm";
import { apps, capabilities, db } from "@cira/db";
import { packSource, sourceStore, tarUngzip } from "@cira/deploy";
import { analyzeCapabilities } from "@/lib/capability-analyzer";
import type { AnalyzedCapability } from "@/lib/capability-grounding";
import { replaceCapabilities } from "@/lib/capabilities";

/**
 * Read an app's source and write down what it can do.
 *
 * Extracted from the deploy so that it is not only reachable from a deploy.
 * Analysis is the one step here that depends on something outside Cira and
 * Google both - a model, and an account with credit in it - so it is also the
 * step most likely to be the only part of a deploy that did not happen. When
 * it fails the app is still built, still running and still perfectly usable;
 * it simply has nothing to offer an agent, and until now the only way to try
 * again was to deploy the whole thing again.
 */

export interface AnalysisTarget {
  id: string;
  spaceId: string;
  name: string;
  description: string | null;
}

export type AnalysisOutcome =
  | {
      ok: true;
      /** The whole list, because the CLI names each one as it deploys. */
      detected: readonly AnalyzedCapability[];
      read: number;
      skipped: number;
    }
  | { ok: false; error: string; reason: "source" | "model" };

export async function analyzeAppSource(args: {
  app: AnalysisTarget;
  /** Whose upload this is. The archive's path is built from it. */
  userId: string;
  sourceId: string;
}): Promise<AnalysisOutcome> {
  const store = sourceStore();

  const stored = await store.find({ userId: args.userId, sourceId: args.sourceId });
  if (stored === null) {
    return {
      ok: false,
      reason: "source",
      error: "The code this app was built from is no longer stored.",
    };
  }

  let source;
  try {
    source = packSource(tarUngzip(await store.download(stored)));
  } catch {
    return {
      ok: false,
      reason: "source",
      error: "The code this app was built from could not be read.",
    };
  }

  const known = await db()
    .select({
      name: capabilities.name,
      method: capabilities.method,
      path: capabilities.path,
    })
    .from(capabilities)
    .where(eq(capabilities.appId, args.app.id));
  const result = await analyzeCapabilities(source.text, {
    appName: args.app.name,
    known,
  });
  if (!result.ok) return { ok: false, reason: "model", error: result.error };

  // Written once and then left alone. A description someone has edited is a
  // human decision, and a later run of the analyzer is not a reason to
  // overwrite it - which is also why this checks the column rather than
  // tracking a flag nobody would remember to set.
  if (
    result.summary !== "" &&
    (args.app.description === null || args.app.description.trim() === "")
  ) {
    await db()
      .update(apps)
      .set({ description: result.summary, updatedAt: new Date() })
      .where(eq(apps.id, args.app.id));
  }

  await replaceCapabilities({
    appId: args.app.id,
    spaceId: args.app.spaceId,
    detected: result.capabilities,
  });

  // Stamped only on a run that reached an answer, and stamped even when the
  // answer was empty: "looked, found nothing" is a real result and the only
  // thing that distinguishes it from never having looked.
  await db()
    .update(apps)
    .set({ capabilitiesAnalyzedAt: new Date(), updatedAt: new Date() })
    .where(eq(apps.id, args.app.id));

  return {
    ok: true,
    detected: result.capabilities,
    read: source.included.length,
    skipped: source.omitted.length,
  };
}
