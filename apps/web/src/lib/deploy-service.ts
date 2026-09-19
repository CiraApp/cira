import "server-only";

import { and, count, eq, gt, inArray } from "drizzle-orm";
import {
  apps,
  appAccess,
  appSlugHistory,
  atomically,
  db,
  deployments,
  memberships,
  services,
  spaces,
} from "@cira/db";
import {
  DEFAULT_LIMITS,
  canManageApp,
  checkDeployRate,
  checkNewApp,
  newId,
  slugify,
} from "@cira/core";
import type { DeployableService, DeployedProcess } from "@cira/core";
import type { ContainerHints, Framework, User } from "@cira/core";
import { archiveUri, deploymentProvider, sourceStore } from "@cira/deploy";
import { recordEnvVars } from "@/lib/env-vars";
import { recordProcesses, specsFor } from "@/lib/processes";

export type DeployOutcome =
  | { ok: true; appId: string; appSlug: string; spaceSlug: string; deploymentId: string }
  | {
      ok: false;
      error: string;
      /** Refused by a limit rather than by anything wrong with the request. */
      limited?: true;
    };

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
  /**
   * The halves of the repository, when there is more than one.
   *
   * Null covers both an older CLI and the ordinary single-service app, and
   * both resolve to the same one-service shape below, so nothing downstream
   * has to care which it was.
   */
  services?: readonly DeployableService[] | null;
  /** Handed to the provider and then forgotten. See docs/secrets.md. */
  env?: Readonly<Record<string, string>>;
  /**
   * Whether the repository has a web process. False for an app that is only
   * workers and scheduled runs. Absent from an older CLI, which means yes.
   */
  web?: boolean;
  /** Workers and scheduled runs found in the repository. */
  processes?: readonly DeployedProcess[];
}): Promise<DeployOutcome> {
  const { user, spaceSlug, appName } = args;
  const env = args.env ?? {};
  const servesWeb = args.web !== false;

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

  // Every deploy is a paid build in a project every company shares, so a
  // space may only start so many an hour. Checked before anything is written
  // or built, so a refused deploy leaves no trace and costs nothing.
  const now = new Date();
  const recent = await database
    .select({ createdAt: deployments.createdAt })
    .from(deployments)
    .innerJoin(apps, eq(apps.id, deployments.appId))
    .where(
      and(
        eq(apps.spaceId, space.id),
        gt(deployments.createdAt, new Date(now.getTime() - 3_600_000)),
      ),
    );
  const rate = checkDeployRate(
    recent.map((r) => r.createdAt),
    now,
    DEFAULT_LIMITS,
  );
  if (!rate.ok) return { ok: false, error: rate.message, limited: true };

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
    // Only a new app counts against the space's allowance. Redeploying one it
    // already has is never refused, so a limit cannot stand in front of a fix.
    const [held] = await database
      .select({ n: count() })
      .from(apps)
      .where(eq(apps.spaceId, space.id));
    const room = checkNewApp(held?.n ?? 0, DEFAULT_LIMITS);
    if (!room.ok) return { ok: false, error: room.message, limited: true };

    const slug = await freeSlug(space.id, slugify(appName));
    const appId = newId("app");

    // A brand new app is visible to its deployer only. Widening it is a
    // deliberate act in the app's Access panel, never a side effect of
    // shipping - and the two halves of that sentence should not be able to
    // come apart.
    //
    // An owner can open their own app whether or not this grant exists, so
    // today the grant going missing costs nothing. That is exactly why it is
    // written this way: the thing making it harmless is a shortcut in
    // `canAccessApp`, in another package, which nothing here can see and
    // nothing obliges to stay. Depending on it silently is how this becomes a
    // real hole the day ownership is expressed as a grant like everything else.
    await atomically(database, (on) => [
      on.insert(apps).values({
        id: appId,
        spaceId: space.id,
        name: appName,
        slug,
        status: "deploying",
        ownerUserId: user.id,
      }),
      on.insert(appAccess).values({
        id: newId("access"),
        appId,
        type: "user",
        targetId: user.id,
      }),
    ]);

    // Read back rather than returned. A batch hands back its results by
    // position, and reaching into one by index reads far worse than a query
    // that says what it is after.
    const [created] = await database
      .select()
      .from(apps)
      .where(eq(apps.id, appId))
      .limit(1);

    if (created === undefined) {
      return { ok: false, error: "Could not create the app." };
    }
    app = created;
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

  // One shape from here down, whatever the CLI sent. An app that is a single
  // process is a single service called `app`, which is what every app deployed
  // before this already became when its row was written.
  const parts: DeployableService[] =
    args.services !== null && args.services !== undefined && args.services.length > 0
      ? [...args.services]
      : [
          {
            slug: "app",
            sourcePath: "",
            dockerfile: args.container?.dockerfile ?? null,
            port: args.container?.port ?? null,
            ingress: servesWeb,
          },
        ];

  // Exactly one takes the port, or - for an app that is only workers and
  // scheduled runs - none does. A repository the CLI could not read that way
  // does not reach here; it is stopped before anything is uploaded, so this is
  // the last line of defence rather than the decision.
  const declared = args.processes ?? [];
  const refusal =
    servesWeb && parts.filter((part) => part.ingress).length !== 1
      ? "Cira could not tell which part of this app a browser should open."
      : !servesWeb && parts.some((part) => part.ingress)
        ? "This app says it has no web process, and one of its parts takes the port."
        : !servesWeb && declared.length === 0
          ? "This app has no web process and nothing else to run."
          : declared.some((p) => !parts.some((part) => part.slug === p.service))
            ? "A worker or scheduled run names a part of this app that is not in it."
            : null;
  if (refusal !== null) {
    await database
      .update(apps)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(apps.id, app.id));
    return { ok: false, error: refusal };
  }

  await recordServices(app.id, parts);
  const stored = await recordProcesses({
    appId: app.id,
    spaceId: space.id,
    declared,
  });

  let result;
  try {
    const provider = deploymentProvider();
    result = await provider.deploy({
      appId: app.id,
      spaceSlug: space.slug,
      appSlug: app.slug,
      framework: args.framework,
      source: { uri: archiveUri(source), size: source.size },
      services: parts,
      env,
      processes: specsFor(stored),
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
    servesWeb,
  });

  return {
    ok: true,
    appId: app.id,
    appSlug: app.slug,
    spaceSlug: space.slug,
    deploymentId,
  };
}

/**
 * An address no app in this space answers on, now or before.
 *
 * "Or before" is the part that is easy to leave out, and leaving it out is
 * silent. Rename Wave to Wave Beats and `wave` becomes a forwarding note;
 * deploy something new called Wave and it would take `wave` back, because the
 * two live in different tables and nothing collides. No error, no warning -
 * just every link anybody ever shared to the first app quietly arriving at a
 * different one.
 *
 * So a forwarding note holds its address as firmly as a live app does, and the
 * new app becomes `wave-2`. Being asked to look at a name you did not expect
 * is a great deal better than a link that goes somewhere plausible and wrong.
 *
 * Notes do not outlive their app: the history rows cascade when it is deleted,
 * so a name genuinely given up becomes available again.
 */
async function freeSlug(spaceId: string, base: string): Promise<string> {
  const database = db();
  const start = base === "" ? "app" : base;

  for (let attempt = 1; attempt <= 25; attempt += 1) {
    const candidate = attempt === 1 ? start : `${start}-${attempt}`;

    const [live] = await database
      .select({ id: apps.id })
      .from(apps)
      .where(and(eq(apps.spaceId, spaceId), eq(apps.slug, candidate)))
      .limit(1);
    if (live !== undefined) continue;

    const [forwarded] = await database
      .select({ id: appSlugHistory.id })
      .from(appSlugHistory)
      .where(and(eq(appSlugHistory.spaceId, spaceId), eq(appSlugHistory.slug, candidate)))
      .limit(1);
    if (forwarded === undefined) return candidate;
  }

  return `${start}-${newId("app").slice(-6)}`;
}

/**
 * What this app is made of, as of this deploy.
 *
 * A redeploy is the truth about that, the same way it is the truth about an
 * app's capabilities: a half that has been deleted from the repository stops
 * existing here rather than lingering as a container nobody builds. Written as
 * one act, because a half-replaced list of an app's parts is not a list of
 * anything.
 */
async function recordServices(
  appId: string,
  parts: readonly DeployableService[],
): Promise<void> {
  const database = db();

  const existing = await database
    .select({ id: services.id, slug: services.slug })
    .from(services)
    .where(eq(services.appId, appId));

  const bySlug = new Map(existing.map((row) => [row.slug, row.id]));
  const wanted = new Set(parts.map((part) => part.slug));
  const gone = existing.filter((row) => !wanted.has(row.slug)).map((row) => row.id);

  const columns = (part: DeployableService) => ({
    appId,
    slug: part.slug,
    sourcePath: part.sourcePath,
    dockerfile: part.dockerfile,
    port: part.port === null ? null : String(part.port),
    updatedAt: new Date(),
  });

  await atomically(database, (on) => [
    ...(gone.length > 0 ? [on.delete(services).where(inArray(services.id, gone))] : []),
    ...parts.map((part) => {
      const id = bySlug.get(part.slug);
      return id === undefined
        ? on.insert(services).values({ id: newId("service"), ...columns(part) })
        : on.update(services).set(columns(part)).where(eq(services.id, id));
    }),
  ]);
}
