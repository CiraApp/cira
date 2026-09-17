"use server";

import { deploymentProvider } from "@cira/deploy";
import { ForbiddenError, NotFoundError, requireAppManage } from "@/lib/authz";
import { analyzeAppSource } from "@/lib/capability-analysis";
import { latestDeployment } from "@/lib/queries";

/**
 * Work out an app's capabilities again, for an app that has none.
 *
 * Analysis is the one part of a deploy that leans on something neither Cira
 * nor Google provides, and it fails on its own: the app builds, ships and
 * serves, and the only thing missing is the list of what it can do. Before
 * this, the only way to try again was to deploy the whole thing a second time
 * for no other reason.
 *
 * It does not need the source sent again. Google kept the archive the build
 * used and remembers which one it was, so Cira asks the build rather than
 * keeping its own note - a note could disagree with what was really built, and
 * would only exist for deploys made after somebody thought to write it.
 *
 * Restricted to whoever can manage the app, because a run costs real money and
 * a button anyone could hold down is a bill.
 */
export type RetryResult = { ok: true; detected: number } | { ok: false; error: string };

export async function retryCapabilityAnalysis(
  spaceSlug: string,
  appSlug: string,
): Promise<RetryResult> {
  try {
    const ctx = await requireAppManage(spaceSlug, appSlug);

    const deployment = await latestDeployment(ctx.app.id);
    if (deployment === null || deployment.status !== "live") {
      return {
        ok: false,
        error: "This app is not running, so there is nothing to read yet.",
      };
    }

    const source = await deploymentProvider().sourceOf(deployment.providerDeploymentId);
    if (source === null) {
      return {
        ok: false,
        error:
          "The code behind this deploy is no longer available. Deploy again to work out its capabilities.",
      };
    }

    const outcome = await analyzeAppSource({
      app: {
        id: ctx.app.id,
        spaceId: ctx.app.spaceId,
        name: ctx.app.name,
        description: ctx.app.description,
      },
      userId: source.userId,
      sourceId: source.sourceId,
    });

    if (!outcome.ok) return { ok: false, error: outcome.error };
    return { ok: true, detected: outcome.detected.length };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "You do not have permission to change this app." };
    }
    if (error instanceof NotFoundError) {
      return { ok: false, error: "That app no longer exists." };
    }
    throw error;
  }
}
