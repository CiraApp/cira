"use server";

import { deploymentProvider } from "@cira/deploy";
import {
  ForbiddenError,
  NotFoundError,
  requireAppAccess,
  requireAppManage,
} from "@/lib/authz";
import { analyzeAppSource } from "@/lib/capability-analysis";
import { verifyAppCapabilities } from "@/lib/capability-verification";
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

    // And then ask the app about them, which is the half this used to skip.
    // Finding a capability does not publish it; the app confirming it does.
    // Without this the whole set sat unverified for ever, which the panel
    // reported honestly as "Checking" and which looked exactly like a page
    // that had not finished loading.
    await verifyAppCapabilities(ctx.app.id);

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

/**
 * Ask the app about whatever is still waiting to be asked about.
 *
 * Verification is a separate act from finding, and anything that interrupts
 * between the two leaves a capability registered but unusable - no agent can
 * reach it, and the panel says "Checking" for ever. That state used to have no
 * way out at all: the only control that ran verification lived in the empty
 * state, which by definition was not on screen once there were capabilities to
 * look at.
 *
 * So it is not a control any more. Looking at the app is what settles it, the
 * same bargain the deployment status and the front-door probe already make.
 */
export async function verifyPendingCapabilities(
  spaceSlug: string,
  appSlug: string,
): Promise<{ settled: boolean }> {
  try {
    // Access rather than manage: this writes nothing a person chose. It asks
    // an app what it serves and records the answer, which is bookkeeping, and
    // holding it behind management would leave the panel stuck for everybody
    // else who can open the app.
    const ctx = await requireAppAccess(spaceSlug, appSlug);
    const outcome = await verifyAppCapabilities(ctx.app.id);
    return { settled: outcome.ok };
  } catch {
    // Nothing here is worth interrupting a page for. The panel goes on saying
    // it is checking, which remains true.
    return { settled: false };
  }
}
