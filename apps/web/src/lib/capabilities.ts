import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import {
  apps,
  appAccess,
  atomically,
  capabilities,
  db,
  deployments,
  spaces,
} from "@cira/db";
import {
  canAccessApp,
  currentReach,
  newId,
  reconcileCapabilities,
  type App,
  type AppAccess,
  type Capability,
  type User,
} from "@cira/core";
import type { AnalyzedCapability } from "@/lib/capability-grounding";
import { humanize } from "@/lib/ask/words";
import { refusedMessage } from "@/lib/messages";
import { notifyManagers } from "@/lib/notify";
import { userManages } from "@/lib/app-rights";
import { principalFor } from "@/lib/principal";

/**
 * The capability registry.
 *
 * Every read here starts from the acting user and ends at the apps they can
 * already open. There is no capability-level permission model and there
 * deliberately is not one: a capability is something an app does, so the right
 * to use it is the right to use the app. That keeps one rule to reason about
 * instead of two that can disagree.
 *
 * The user is passed in rather than read from a session, because these are
 * reached three ways - a page, the CLI, and an agent over MCP - and only one
 * of those has a session. Making the caller say who is acting is what keeps
 * the three paths from drifting into three different answers.
 */

/**
 * The one refusal for a capability the caller may not have.
 *
 * Worded identically whether the capability does not exist or exists behind an
 * app they cannot open, because anything that distinguishes the two turns a
 * capability id into an oracle: someone holding a list of ids could map what a
 * company runs without being able to call any of it. Naming both possibilities
 * gives a person who hit this by mistake somewhere to go, and still tells a
 * prober nothing - the sentence is the same either way.
 */
export const NO_SUCH_CAPABILITY =
  "No such capability, or you do not have access to the app it belongs to.";

export interface CapabilityWithApp extends Capability {
  appName: string;
  appSlug: string;
  spaceSlug: string;
  /** Whether this app is told who is calling; see identity-assertion.ts. */
  appTellsWhoIsCalling: boolean;
}

/** Everything the signed-in user may see, across every space they are in. */
export async function listCapabilitiesForUser(
  user: User,
  /** Only this space's, for a surface opened inside one. */
  inSpace?: string,
): Promise<CapabilityWithApp[]> {
  const { rows } = await visibleCapabilities(user);
  return within(rows, inSpace);
}

/** Rows from one space, or all of them when no space was named. */
function within(rows: CapabilityWithApp[], inSpace: string | undefined) {
  return inSpace === undefined ? rows : rows.filter((row) => row.spaceSlug === inSpace);
}

/**
 * Capability search.
 *
 * Substring matching over name, description and app name, which is what the
 * spec asks for. No vector database: a company's shelf is tens of capabilities,
 * not millions, and an index nobody needs is an index somebody maintains.
 */
export async function searchCapabilitiesForUser(
  user: User,
  query: string,
  limit = 20,
  inSpace?: string,
): Promise<CapabilityWithApp[]> {
  const rows = within((await visibleCapabilities(user)).rows, inSpace);
  const needle = query.trim().toLowerCase();
  if (needle === "") return rows.slice(0, limit);

  const words = needle.split(/\s+/).filter((w) => w.length > 1);

  const scored = rows
    .map((row) => {
      const haystack = `${row.name} ${row.description} ${row.appName}`.toLowerCase();
      // Every word has to appear somewhere, then more matches rank higher.
      // Enough for a shelf this size, and it never surprises anyone.
      const hits = words.filter((word) => haystack.includes(word)).length;
      const exact = row.name.toLowerCase() === needle ? 10 : 0;
      return { row, score: hits + exact };
    })
    .filter((entry) => entry.score > 0 || words.length === 0)
    .sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name));

  return scored.slice(0, limit).map((entry) => entry.row);
}

/** One capability, if this user may see it. */
export async function getCapabilityForUser(
  user: User,
  capabilityId: string,
  inSpace?: string,
): Promise<CapabilityWithApp | null> {
  const { rows } = await visibleCapabilities(user);
  return within(rows, inSpace).find((row) => row.id === capabilityId) ?? null;
}

/**
 * Turn a capability on or off.
 *
 * Restricted to whoever can manage the app, because enabling one is the moment
 * a detected operation becomes something agents can actually run.
 */
export async function updateCapabilityEnabled(
  user: User,
  capabilityId: string,
  enabled: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const database = db();

  const [row] = await database
    .select({ capability: capabilities, app: apps })
    .from(capabilities)
    .innerJoin(apps, eq(apps.id, capabilities.appId))
    .where(eq(capabilities.id, capabilityId))
    .limit(1);

  if (row === undefined) return { ok: false, error: NO_SUCH_CAPABILITY };

  const allowed = await userManages(user, toApp(row.app));

  // The same sentence the missing-row case returns, so this cannot be used to
  // learn that a capability exists.
  if (!allowed) return { ok: false, error: NO_SUCH_CAPABILITY };

  await database
    .update(capabilities)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(capabilities.id, capabilityId));

  const { record } = await import("@/lib/change-record");
  await record({
    spaceId: row.app.spaceId,
    kind: enabled ? "capability-enabled" : "capability-disabled",
    actor: user.name,
    actorUserId: user.id,
    subject: `${row.capability.name} on ${row.app.name}`,
    appId: row.app.id,
  });

  return { ok: true };
}

/**
 * Replace an app's capability set after a deploy.
 *
 * A redeploy is the truth about what the app can now do, so a capability whose
 * code has gone stops existing rather than lingering as a target that no longer
 * answers. An operation that survives keeps its id and - importantly - whatever
 * decision a person already made about it: re-detecting `createRefund` must not
 * quietly switch it back on.
 */
export async function replaceCapabilities(args: {
  appId: string;
  spaceId: string;
  detected: readonly AnalyzedCapability[];
}): Promise<{ enabled: number; review: number }> {
  const database = db();

  const existing = await database
    .select({
      id: capabilities.id,
      name: capabilities.name,
      enabled: capabilities.enabled,
      method: capabilities.method,
      path: capabilities.path,
      risk: capabilities.risk,
    })
    .from(capabilities)
    .where(eq(capabilities.appId, args.appId));

  // What changes is decided in core, without a database in the way, so the
  // rule that a person's decision survives a redeploy is testable on its own.
  const plan = reconcileCapabilities(existing, args.detected);

  const columns = (detected: AnalyzedCapability, enabled: boolean) => ({
    appId: args.appId,
    spaceId: args.spaceId,
    name: detected.name,
    description: detected.description,
    inputSchema: detected.inputSchema,
    outputSchema: detected.outputSchema,
    method: detected.method,
    path: detected.path,
    risk: detected.risk,
    enabled,
    probe: detected.probe ?? null,
    updatedAt: new Date(),
  });

  const before = new Map(existing.map((row) => [row.id, row]));

  // The deletion has to land with the writes that replace it. On its own it is
  // the destructive half of a swap, and a failure after it leaves the app
  // advertising a fraction of what it can do - every write having succeeded,
  // and nothing anywhere to say the set is incomplete.
  await atomically(database, (on) => [
    ...(plan.remove.length > 0
      ? [on.delete(capabilities).where(inArray(capabilities.id, plan.remove))]
      : []),

    ...plan.create.map((entry) =>
      on
        .insert(capabilities)
        .values({ id: newId("capability"), ...columns(entry.detected, entry.enabled) }),
    ),

    ...plan.update.map((entry) => {
      const prior = before.get(entry.id);
      // A capability whose target moved has not been confirmed at its new
      // address, so its stamp is cleared and the app is asked again. One whose
      // target is unchanged keeps it, because clearing it would take every
      // working capability away for the seconds between deploying and checking.
      const moved =
        prior === undefined ||
        prior.method !== entry.detected.method ||
        prior.path !== entry.detected.path;

      return on
        .update(capabilities)
        .set({
          ...columns(entry.detected, entry.enabled),
          ...(moved
            ? { verifiedAt: null, reach: "pending" as const, answeredBy: null }
            : {}),
        })
        .where(eq(capabilities.id, entry.id));
    }),
  ]);

  return { enabled: plan.enabledCount, review: plan.reviewCount };
}

/**
 * Record what the deployed app said about the capabilities credited to it.
 *
 * Those it has no route for are deleted rather than kept and flagged: a
 * capability nothing serves is not a finding, it is a mistake, and leaving it
 * in the table means every reader has to know to skip it.
 *
 * A refusal is the opposite case and is kept. The route is real and the
 * analysis was right about it; the only thing missing is a way for Cira to be
 * somebody the app will talk to. Deleting those would throw away a true
 * description of the app and leave the page with nothing to explain, which is
 * how nineteen working routes came to look like nineteen mysterious 401s.
 */
export async function recordVerification(args: {
  appId: string;
  /** The deployment that answered, so a refusal can age with its build. */
  deploymentId: string;
  callable: readonly string[];
  refused: readonly string[];
  absent: readonly string[];
}): Promise<void> {
  const database = db();
  const stamped = new Date();

  const mine = (names: readonly string[]) =>
    and(eq(capabilities.appId, args.appId), inArray(capabilities.name, [...names]));

  // Anything that worked under an earlier build and is refused by this one
  // stopped working, which is news to whoever manages the app. One refused
  // from the start is shown on the page and is not.
  const lost =
    args.refused.length === 0
      ? []
      : await database
          .select({ id: capabilities.id, name: capabilities.name })
          .from(capabilities)
          .where(and(mine(args.refused), eq(capabilities.reach, "callable")));

  // One answer from the app, so one write. Splitting it would allow a state
  // where the absent ones are gone but the confirmed ones are still waiting to
  // be confirmed, which is no app's actual answer.
  await atomically(database, (on) => [
    ...(args.absent.length > 0 ? [on.delete(capabilities).where(mine(args.absent))] : []),

    ...(args.callable.length > 0
      ? [
          on
            .update(capabilities)
            .set({
              reach: "callable",
              answeredBy: args.deploymentId,
              verifiedAt: stamped,
              updatedAt: stamped,
            })
            .where(mine(args.callable)),
        ]
      : []),

    ...(args.refused.length > 0
      ? [
          on
            .update(capabilities)
            .set({
              reach: "refused",
              answeredBy: args.deploymentId,
              verifiedAt: stamped,
              updatedAt: stamped,
            })
            .where(mine(args.refused)),
        ]
      : []),
  ]);

  for (const capability of lost) {
    await tellRefused(args.appId, capability, args.deploymentId);
  }
}

/** Tell an app's managers that one of its capabilities stopped letting Cira in. */
async function tellRefused(
  appId: string,
  capability: { id: string; name: string },
  deploymentId: string,
): Promise<void> {
  const [row] = await db()
    .select({ told: apps.tellsWhoIsCalling })
    .from(apps)
    .where(eq(apps.id, appId))
    .limit(1);
  const told = row?.told;
  await notifyManagers({
    appId,
    kind: "capability-refused",
    // Per build: refused again after a later build let it in is news again.
    subject: `${capability.id}:${deploymentId}`,
    compose: (app) =>
      refusedMessage({ app, operation: humanize(capability.name), told: told === true }),
  });
}

/**
 * Put a capability back in front of verification, after a real call to it
 * found nothing at its address.
 *
 * A capability was only ever checked once: confirmed, it stayed confirmed
 * through every later deploy, so a route the app no longer serves - renamed,
 * removed, in a deploy whose analysis failed and left the old list standing -
 * was offered to agents indefinitely. Only a path with no parameters is
 * demoted, because `/orders/{id}` answering 404 is usually the order, not the
 * route. Verification then asks the app, and deletes it if it is really gone.
 */
export async function recordAbsence(capabilityId: string): Promise<void> {
  await db()
    .update(capabilities)
    .set({ reach: "pending", answeredBy: null, updatedAt: new Date() })
    .where(and(eq(capabilities.id, capabilityId), eq(capabilities.reach, "callable")));
}

/**
 * Record that the app turned Cira away from a capability it was really called
 * through, rather than probed.
 *
 * Only ever demotes a `callable` one. Anything else already says as much or
 * more, and this is written from the middle of an agent's request, where
 * overwriting an answer a verification run just gave would be a race nobody
 * could see.
 */
export async function recordRefusal(args: {
  capabilityId: string;
  deploymentId: string;
}): Promise<void> {
  const stamped = new Date();
  const demoted = await db()
    .update(capabilities)
    .set({
      reach: "refused",
      answeredBy: args.deploymentId,
      verifiedAt: stamped,
      updatedAt: stamped,
    })
    .where(
      and(eq(capabilities.id, args.capabilityId), eq(capabilities.reach, "callable")),
    )
    .returning({ appId: capabilities.appId, name: capabilities.name });

  const capability = demoted[0];
  if (capability !== undefined) {
    await tellRefused(
      capability.appId,
      { id: args.capabilityId, name: capability.name },
      args.deploymentId,
    );
  }
}

/** Every capability on an app, for the app's own page. */
export async function listCapabilitiesForApp(appId: string): Promise<Capability[]> {
  return (await capabilitiesOf(appId)).map(({ capability }) => capability);
}

/** A capability as the console draws it: with an input to start the form from. */
export interface ConsoleCapability extends Capability {
  /**
   * The example input verification sent, for a read. Null for a write, which
   * never has one: nothing is allowed to try a write to see if it works, so
   * the form for one starts from the schema's defaults and nothing else.
   */
  example: Record<string, unknown> | null;
}

/**
 * Every capability on an app, for the console.
 *
 * The caller has already established that the person may open the app; this
 * adds nothing a person with that right could not already learn by running a
 * read, since the example is the input the app was really called with.
 */
export async function listConsoleCapabilities(
  appId: string,
): Promise<ConsoleCapability[]> {
  return (await capabilitiesOf(appId)).map(({ capability, row }) => ({
    ...capability,
    example: capability.risk === "read" ? (row.probe ?? null) : null,
  }));
}

async function capabilitiesOf(
  appId: string,
): Promise<Array<{ capability: Capability; row: CapabilityRow }>> {
  const database = db();
  const [rows, serving] = await Promise.all([
    database.select().from(capabilities).where(eq(capabilities.appId, appId)),
    servingDeployments([appId]),
  ]);

  return rows
    .map((row) => ({ row, capability: toCapability(row, serving.get(appId) ?? null) }))
    .sort((a, b) => a.capability.name.localeCompare(b.capability.name));
}

/**
 * Which deployment each app is serving from, for the apps that are serving.
 *
 * The newest deployment, and only if it is live - the same rule as
 * `latestDeployment`, for many apps in one query. An app mid-build or after a
 * failed deploy is absent from the map, which `currentReach` reads as nobody
 * to ask.
 */
async function servingDeployments(
  appIds: readonly string[],
): Promise<Map<string, string>> {
  if (appIds.length === 0) return new Map();

  const newest = await db()
    .selectDistinctOn([deployments.appId], {
      appId: deployments.appId,
      id: deployments.id,
      status: deployments.status,
    })
    .from(deployments)
    .where(inArray(deployments.appId, [...appIds]))
    .orderBy(deployments.appId, desc(deployments.createdAt));

  return new Map(
    newest.filter((row) => row.status === "live").map((row) => [row.appId, row.id]),
  );
}

/**
 * The one query every read above is built on.
 *
 * Loads the user's memberships, the apps in those spaces, and the access
 * grants, then runs the same `canAccessApp` the gallery runs. Written once so
 * that discovery and invocation cannot drift apart.
 */
async function visibleCapabilities(user: User): Promise<{ rows: CapabilityWithApp[] }> {
  const database = db();

  const principal = await principalFor(user);
  if (principal === null) return { rows: [] };

  const spaceIds = principal.memberships.map((m) => m.spaceId);

  const rows = await database
    .select({ capability: capabilities, app: apps })
    .from(capabilities)
    .innerJoin(apps, eq(apps.id, capabilities.appId))
    .where(inArray(capabilities.spaceId, spaceIds));

  if (rows.length === 0) return { rows: [] };

  const grants = (await database
    .select()
    .from(appAccess)
    .where(
      inArray(
        appAccess.appId,
        rows.map((r) => r.app.id),
      ),
    )) as AppAccess[];

  const [slugs, serving] = await Promise.all([
    spaceSlugs(spaceIds),
    servingDeployments([...new Set(rows.map((r) => r.app.id))]),
  ]);

  const visible = rows
    .filter((row) =>
      canAccessApp({
        principal,
        app: toApp(row.app),
        access: grants,
      }),
    )
    .map((row) => ({
      ...toCapability(row.capability, serving.get(row.app.id) ?? null),
      appName: row.app.name,
      appSlug: row.app.slug,
      appTellsWhoIsCalling: row.app.tellsWhoIsCalling,
      spaceSlug: slugs.get(row.app.spaceId) ?? "",
    }));

  return { rows: visible };
}

/** Slugs for the URL a capability's app lives at. */
async function spaceSlugs(spaceIds: string[]): Promise<Map<string, string>> {
  const rows = await db()
    .select({ id: spaces.id, slug: spaces.slug })
    .from(spaces)
    .where(inArray(spaces.id, spaceIds));
  return new Map(rows.map((row) => [row.id, row.slug]));
}

type CapabilityRow = typeof capabilities.$inferSelect;

function toCapability(row: CapabilityRow, serving: string | null): Capability {
  // Read through the build that is serving now, so a refusal from an older
  // one comes back as pending - here, once, rather than in each reader.
  const reach = currentReach(row, serving);

  return {
    id: row.id,
    spaceId: row.spaceId,
    appId: row.appId,
    name: row.name,
    description: row.description,
    inputSchema: row.inputSchema as Record<string, unknown>,
    outputSchema: (row.outputSchema as Record<string, unknown> | null) ?? null,
    target: { type: "http", method: row.method, path: row.path },
    // Rows written before the grade was narrowed can still say `destructive`.
    // It was always withheld exactly as a write was, so reading it as one
    // loses nothing and keeps a single meaning in the rest of the code.
    risk: row.risk === "read" ? "read" : "write",
    // Anything the app has not said yes to is not enabled, whatever the policy
    // decided. Publication is settled when the capability is detected; whether
    // the app will actually let Cira call it is settled later, by asking.
    // Folding the two here means every reader - the panel, the agent surface,
    // invocation - gets the same answer from one rule rather than each
    // remembering to check. That is also why widening it from a boolean fixed
    // the agent surface without the agent surface being touched.
    enabled: row.enabled && reach === "callable",
    reach,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** An app row as the access rules read it. */
export function toApp(row: typeof apps.$inferSelect): App {
  return {
    id: row.id,
    spaceId: row.spaceId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    status: row.status,
    icon: row.icon,
    image: row.image,
    ownerUserId: row.ownerUserId,
    homepageUrl: row.homepageUrl,
    hasWebUi: row.hasWebUi,
    minInstances: row.minInstances,
    memoryMiB: row.memoryMiB,
    declaredMemoryMiB: row.declaredMemoryMiB,
    tellsWhoIsCalling: row.tellsWhoIsCalling,
    capabilitiesAnalyzedAt: row.capabilitiesAnalyzedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
