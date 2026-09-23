"use server";

import { and, desc, eq, gt, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { apps, db, deployments } from "@cira/db";
import { newId } from "@cira/core";
import type { App, Deployment } from "@cira/core";
import { deploymentProvider } from "@cira/deploy";
import { ForbiddenError, NotFoundError, requireAppManage } from "@/lib/authz";
import { record } from "@/lib/change-record";
import { supersedeEarlierDeploys } from "@/lib/deployment-sync";

/**
 * Putting an app back on a version it ran before.
 *
 * Until now the only way out of a bad deploy was forward: find the problem,
 * commit a fix, wait for a build, with the app broken throughout. Every build
 * Cira has made is still in the registry, so going back is a matter of
 * pointing the app at one of them, and takes seconds rather than minutes.
 *
 * It is not a time machine, and Cira does not pretend otherwise. What a newer
 * version's release command did to a database is still done; the app going
 * back does not undo it. So a rollback past a migration is offered with that
 * said plainly, rather than quietly.
 *
 * Deliberately not gated on the plan, unlike deploying. A space whose trial
 * ended cannot ship new code, and everything it deployed keeps answering; a
 * rollback ships nothing new - it returns to a build this company already
 * paid to build and already ran. Refusing it would be holding an app broken
 * over an invoice.
 */

export type RollbackResult = { ok: true } | { ok: false; error: string };

export interface RollbackPlan {
  /** What the app will be running afterwards, for the confirmation. */
  when: string;
  /** Whether anything between that version and now ran a release command. */
  ranSetup: boolean;
  /** True when this is the version already serving: a redeploy, not a rollback. */
  current: boolean;
}

/** What going back to this deploy would mean, before anyone commits to it. */
export async function planRollback(
  spaceSlug: string,
  appSlug: string,
  deploymentId: string,
): Promise<{ ok: true; plan: RollbackPlan } | { ok: false; error: string }> {
  const found = await rollbackTarget(spaceSlug, appSlug, deploymentId);
  if (!found.ok) return found;
  const going = found.deployment;

  const [migrated] = await db()
    .select({ id: deployments.id })
    .from(deployments)
    .where(
      and(
        eq(deployments.appId, going.appId),
        gt(deployments.createdAt, going.createdAt),
        isNotNull(deployments.releaseRun),
      ),
    )
    .limit(1);

  const [newest] = await db()
    .select({ id: deployments.id })
    .from(deployments)
    .where(eq(deployments.appId, going.appId))
    .orderBy(desc(deployments.createdAt))
    .limit(1);

  return {
    ok: true,
    plan: {
      when: going.createdAt.toISOString(),
      ranSetup: migrated !== undefined,
      current: newest?.id === going.id,
    },
  };
}

/**
 * Point the app back at an earlier build: its web traffic, its workers and its
 * scheduled runs together, with the variables it has now.
 */
export async function rollBackTo(
  spaceSlug: string,
  appSlug: string,
  deploymentId: string,
): Promise<RollbackResult> {
  const found = await rollbackTarget(spaceSlug, appSlug, deploymentId);
  if (!found.ok) return found;
  const going = found.deployment;

  const provider = deploymentProvider();
  if (provider.restore === undefined) {
    return { ok: false, error: "This Cira cannot put an app back on an earlier build." };
  }

  const database = db();
  await database
    .update(apps)
    .set({ status: "deploying", updatedAt: new Date() })
    .where(eq(apps.id, going.appId));

  let result;
  try {
    result = await provider.restore(going.providerDeploymentId);
  } catch (error) {
    await database
      .update(apps)
      .set({ status: found.appStatus, updatedAt: new Date() })
      .where(eq(apps.id, going.appId));
    return {
      ok: false,
      error:
        error instanceof Error && error.message !== ""
          ? `That version could not be brought back: ${error.message}`
          : "That version could not be brought back. Its build may no longer be there.",
    };
  }

  if (result.status === "removed") {
    await database
      .update(apps)
      .set({ status: found.appStatus, updatedAt: new Date() })
      .where(eq(apps.id, going.appId));
    return { ok: false, error: "That version is no longer there to go back to." };
  }

  // A row of its own, rather than reviving the old one: the history is meant
  // to say what happened, and what happened is that someone went back today.
  const id = newId("deployment");
  await database.insert(deployments).values({
    id,
    appId: going.appId,
    provider: going.provider,
    serviceId: found.serviceId,
    providerDeploymentId: going.providerDeploymentId,
    status: result.status,
    url: result.url ?? going.url,
    servesWeb: going.servesWeb,
    warning: result.warning ?? null,
    // The release command already ran, on this build, when it was first
    // deployed. Nothing here must run it again: a migration written to move a
    // schema forward is not one that can be run a second time, and running it
    // on the way back is how a rollback loses data.
    releaseDoneAt: new Date(),
    restoredFromId: going.id,
    // Who went back, not who built it; what it was built from is the same.
    deployedByUserId: found.actorUserId,
    sourceLabel: going.sourceLabel,
  });
  await supersedeEarlierDeploys(going.appId, id);

  // An app of only workers and scheduled runs is back the moment they are:
  // there is no revision to wait on, and nothing polls a deploy that is
  // already finished, so the app would otherwise sit at "deploying" for good.
  if (result.status === "live") {
    await database
      .update(apps)
      .set({ status: "live", updatedAt: new Date() })
      .where(eq(apps.id, going.appId));
  }

  await record({
    spaceId: found.spaceId,
    kind: "app-rolled-back",
    actor: found.actor,
    actorUserId: found.actorUserId,
    subject: found.appName,
    appId: going.appId,
    detail: `the build from ${going.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC`,
  });

  revalidatePath(`/${spaceSlug}/${appSlug}`);
  return { ok: true };
}

/**
 * The deploy being gone back to, when this person may and when there is
 * something to go back to.
 */
async function rollbackTarget(
  spaceSlug: string,
  appSlug: string,
  deploymentId: string,
): Promise<
  | {
      ok: true;
      deployment: Deployment;
      serviceId: string | null;
      appStatus: App["status"];
      spaceId: string;
      appName: string;
      actor: string;
      actorUserId: string;
    }
  | { ok: false; error: string }
> {
  let ctx;
  try {
    ctx = await requireAppManage(spaceSlug, appSlug);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return { ok: false, error: "No such app." };
    }
    if (error instanceof ForbiddenError) {
      return {
        ok: false,
        error: "You do not manage this app, so you cannot change what it runs.",
      };
    }
    throw error;
  }

  const [row] = await db()
    .select()
    .from(deployments)
    .where(and(eq(deployments.id, deploymentId), eq(deployments.appId, ctx.app.id)))
    .limit(1);
  if (row === undefined) return { ok: false, error: "No such deploy of this app." };

  // Only a build that once served has anything to go back to. A failed deploy
  // may never have been built at all.
  if (row.status !== "live" && row.status !== "superseded") {
    return {
      ok: false,
      error: "That deploy never went live, so there is no build to go back to.",
    };
  }

  return {
    ok: true,
    deployment: row as Deployment,
    serviceId: row.serviceId,
    appStatus: ctx.app.status,
    spaceId: ctx.space.id,
    appName: ctx.app.name,
    actor: ctx.user.name,
    actorUserId: ctx.user.id,
  };
}
