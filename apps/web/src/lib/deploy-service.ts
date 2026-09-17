import "server-only";

import { and, eq } from "drizzle-orm";
import { apps, appAccess, db, deployments, memberships, spaces } from "@cira/db";
import { newId, slugify, canManageApp } from "@cira/core";
import type { ContainerHints, Framework, User } from "@cira/core";
import { archiveUri, deploymentProvider, sourceStore } from "@cira/deploy";
import { recordEnvVars } from "@/lib/env-vars";

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
  /** Names an archive already uploaded by this user. */
  sourceId: string;
  /** What the source looks like. A label on the app, not a gate on the build. */
  framework: Framework;
  /**
   * What the source says about building itself, when it says.
   *
   * Read by the CLI, which is walking the files anyway, rather than by
   * unpacking the archive again here. A client claiming a Dockerfile it does
   * not have gets a build that fails, which is its own problem.
   */
  container: ContainerHints | null;
  /** Handed to the provider and then forgotten. See docs/secrets.md. */
  env?: Readonly<Record<string, string>>;
}): Promise<DeployOutcome> {
  const { user, spaceSlug, appName } = args;
  const env = args.env ?? {};

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
    // Setting an app's environment is managing it, so it takes the same rights
    // rather than the weaker "is in this space" that redeploying takes. A first
    // deploy is exempt by construction: the deployer is the owner.
    if (Object.keys(env).length > 0) {
      const mine = await database
        .select({
          id: memberships.id,
          role: memberships.role,
          spaceId: memberships.spaceId,
        })
        .from(memberships)
        .where(eq(memberships.userId, user.id));

      const allowed = canManageApp({
        userId: user.id,
        app,
        memberships: mine.map((m) => ({
          id: m.id,
          userId: user.id,
          spaceId: m.spaceId,
          role: m.role,
        })),
      });

      if (!allowed) {
        return {
          ok: false,
          error: "You cannot set environment variables on an app you do not manage.",
        };
      }
    }

    await database
      .update(apps)
      .set({ status: "deploying", updatedAt: new Date() })
      .where(eq(apps.id, app.id));
  }

  // Resolved here rather than trusted from the request. The path is rebuilt
  // from this user's own id, so an id belonging to someone else does not
  // resolve, and an upload that never finished reads as one that is not there.
  let source;
  try {
    source = await sourceStore().find({ userId: user.id, sourceId: args.sourceId });
  } catch {
    source = null;
  }

  if (source === null) {
    await database
      .update(apps)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(apps.id, app.id));
    return { ok: false, error: "That upload did not finish. Try deploying again." };
  }

  let result;
  try {
    const provider = deploymentProvider();
    result = await provider.deploy({
      appId: app.id,
      spaceSlug: space.slug,
      appSlug: app.slug,
      framework: args.framework,
      source: { uri: archiveUri(source), size: source.size },
      container: args.container,
      env,
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

  // The names, never the values. Recorded after the provider accepted them, so
  // the app page cannot claim a variable is configured when the deploy failed.
  await recordEnvVars({ appId: app.id, userId: user.id, env });

  const deploymentId = newId("deployment");
  await database.insert(deployments).values({
    id: deploymentId,
    appId: app.id,
    provider: "cloudrun",
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
