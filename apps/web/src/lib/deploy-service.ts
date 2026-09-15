import "server-only";

import { and, eq } from "drizzle-orm";
import { apps, appAccess, db, deployments, memberships, spaces } from "@cira/db";
import { newId, slugify } from "@cira/core";
import type { SourceFile, User } from "@cira/core";
import { deploymentProvider } from "@cira/deploy";
import { checkBundle } from "@cira/deploy";

export type DeployOutcome =
  | { ok: true; appId: string; appSlug: string; spaceSlug: string; deploymentId: string }
  | { ok: false; error: string };

/**
 * Deploy a folder into a space on someone's behalf.
 *
 * Membership is checked here rather than trusted from the request: the CLI
 * sends a space slug, not a right to use it.
 */
export async function deployToSpace(args: {
  user: User;
  spaceSlug: string;
  appName: string;
  appId: string | null;
  files: readonly SourceFile[];
}): Promise<DeployOutcome> {
  const { user, spaceSlug, appName, files } = args;

  const bundle = checkBundle(files as Array<SourceFile>);
  if (!bundle.ok) return { ok: false, error: bundle.reason };

  const database = db();

  const [space] = await database
    .select()
    .from(spaces)
    .where(eq(spaces.slug, spaceSlug))
    .limit(1);

  if (space === undefined) return { ok: false, error: "That space does not exist." };

  const [membership] = await database
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), eq(memberships.spaceId, space.id)))
    .limit(1);

  // Not a member reads as "no such space", so deploying cannot be used to
  // discover which companies exist.
  if (membership === undefined) {
    return { ok: false, error: "That space does not exist." };
  }

  // Redeploy an existing app when the folder is already linked, otherwise
  // create one. Relinking is by id, so renaming a folder does not fork the app.
  let app = null;
  if (args.appId !== null) {
    const [existing] = await database
      .select()
      .from(apps)
      .where(and(eq(apps.id, args.appId), eq(apps.spaceId, space.id)))
      .limit(1);
    app = existing ?? null;
  }

  if (app === null) {
    const slug = await freeSlug(space.id, slugify(appName));
    const [created] = await database
      .insert(apps)
      .values({
        id: newId("app"),
        spaceId: space.id,
        name: appName,
        slug,
        status: "deploying",
        ownerUserId: user.id,
      })
      .returning();

    if (created === undefined) {
      return { ok: false, error: "Could not create the app." };
    }
    app = created;

    // A brand new app is visible to its deployer only. Widening it is a
    // deliberate act in the app's Access panel, never a side effect of shipping.
    await database.insert(appAccess).values({
      id: newId("access"),
      appId: app.id,
      type: "user",
      targetId: user.id,
    });
  } else {
    await database
      .update(apps)
      .set({ status: "deploying", updatedAt: new Date() })
      .where(eq(apps.id, app.id));
  }

  let result;
  try {
    const provider = deploymentProvider();
    result = await provider.deploy({
      appId: app.id,
      spaceSlug: space.slug,
      appSlug: app.slug,
      framework: "nextjs",
      files,
      env: {},
    });
  } catch (error) {
    await database
      .update(apps)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(apps.id, app.id));

    return {
      ok: false,
      error: error instanceof Error ? error.message : "The deploy could not be started.",
    };
  }

  // Lock the app down and keep the key. Until this succeeds the app is
  // reachable only by whoever holds a provider account, which is nobody we
  // care about, so a failure here is worth recording but not worth failing
  // the deploy over.
  if (app.accessSecret === null || app.providerProjectId === null) {
    try {
      const secured = await deploymentProvider().secureProject(
        `${space.slug}-${app.slug}`,
      );
      await database
        .update(apps)
        .set({
          providerProjectId: secured.projectId,
          accessSecret: secured.accessSecret,
        })
        .where(eq(apps.id, app.id));
    } catch {
      // Left unset: the app page will say it cannot be opened yet rather than
      // handing anyone a link that does not work.
    }
  }

  const deploymentId = newId("deployment");
  await database.insert(deployments).values({
    id: deploymentId,
    appId: app.id,
    provider: "vercel",
    providerDeploymentId: result.providerDeploymentId,
    status: result.status,
    url: result.url,
  });

  return {
    ok: true,
    appId: app.id,
    appSlug: app.slug,
    spaceSlug: space.slug,
    deploymentId,
  };
}

async function freeSlug(spaceId: string, base: string): Promise<string> {
  const database = db();
  const start = base === "" ? "app" : base;

  for (let attempt = 1; attempt <= 25; attempt += 1) {
    const candidate = attempt === 1 ? start : `${start}-${attempt}`;
    const [taken] = await database
      .select({ id: apps.id })
      .from(apps)
      .where(and(eq(apps.spaceId, spaceId), eq(apps.slug, candidate)))
      .limit(1);
    if (taken === undefined) return candidate;
  }

  return `${start}-${newId("app").slice(-6)}`;
}
