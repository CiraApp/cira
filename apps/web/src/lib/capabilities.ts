import "server-only";

import { eq, inArray } from "drizzle-orm";
import { apps, appAccess, capabilities, db, memberships, spaces } from "@cira/db";
import {
  canAccessApp,
  canManageApp,
  newId,
  reconcileCapabilities,
  type App,
  type AppAccess,
  type Capability,
  type Membership,
  type User,
} from "@cira/core";
import type { AnalyzedCapability } from "@/lib/capability-grounding";

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
}

/** Everything the signed-in user may see, across every space they are in. */
export async function listCapabilitiesForUser(user: User): Promise<CapabilityWithApp[]> {
  const { rows } = await visibleCapabilities(user);
  return rows;
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
): Promise<CapabilityWithApp[]> {
  const { rows } = await visibleCapabilities(user);
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
): Promise<CapabilityWithApp | null> {
  const { rows } = await visibleCapabilities(user);
  return rows.find((row) => row.id === capabilityId) ?? null;
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

  const mine = await database
    .select()
    .from(memberships)
    .where(eq(memberships.userId, user.id));

  const allowed = canManageApp({
    userId: user.id,
    app: toApp(row.app),
    memberships: mine as Membership[],
  });

  // The same sentence the missing-row case returns, so this cannot be used to
  // learn that a capability exists.
  if (!allowed) return { ok: false, error: NO_SUCH_CAPABILITY };

  await database
    .update(capabilities)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(capabilities.id, capabilityId));

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
    })
    .from(capabilities)
    .where(eq(capabilities.appId, args.appId));

  // What changes is decided in core, without a database in the way, so the
  // rule that a person's decision survives a redeploy is testable on its own.
  const plan = reconcileCapabilities(existing, args.detected);

  if (plan.remove.length > 0) {
    await database.delete(capabilities).where(inArray(capabilities.id, plan.remove));
  }

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
    confidence: detected.confidence,
    enabled,
    updatedAt: new Date(),
  });

  for (const entry of plan.create) {
    await database
      .insert(capabilities)
      .values({ id: newId("capability"), ...columns(entry.detected, entry.enabled) });
  }

  for (const entry of plan.update) {
    await database
      .update(capabilities)
      .set(columns(entry.detected, entry.enabled))
      .where(eq(capabilities.id, entry.id));
  }

  return { enabled: plan.enabledCount, review: plan.reviewCount };
}

/** Every capability on an app, for the app's own page. */
export async function listCapabilitiesForApp(appId: string): Promise<Capability[]> {
  const rows = await db()
    .select()
    .from(capabilities)
    .where(eq(capabilities.appId, appId));

  return rows.map(toCapability).sort((a, b) => a.name.localeCompare(b.name));
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

  const mine = (await database
    .select()
    .from(memberships)
    .where(eq(memberships.userId, user.id))) as Membership[];

  if (mine.length === 0) return { rows: [] };

  const spaceIds = mine.map((m) => m.spaceId);

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

  const slugs = await spaceSlugs(spaceIds);

  const visible = rows
    .filter((row) =>
      canAccessApp({
        userId: user.id,
        app: toApp(row.app),
        memberships: mine,
        access: grants,
      }),
    )
    .map((row) => ({
      ...toCapability(row.capability),
      appName: row.app.name,
      appSlug: row.app.slug,
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

function toCapability(row: CapabilityRow): Capability {
  return {
    id: row.id,
    spaceId: row.spaceId,
    appId: row.appId,
    name: row.name,
    description: row.description,
    inputSchema: row.inputSchema as Record<string, unknown>,
    outputSchema: (row.outputSchema as Record<string, unknown> | null) ?? null,
    target: { type: "http", method: row.method, path: row.path },
    risk: row.risk,
    confidence: row.confidence,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toApp(row: typeof apps.$inferSelect): App {
  return {
    id: row.id,
    spaceId: row.spaceId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    status: row.status,
    icon: row.icon,
    ownerUserId: row.ownerUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
