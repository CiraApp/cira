import "server-only";

import { and, asc, count, eq } from "drizzle-orm";
import { appDomains, apps, db, spaces } from "@cira/db";
import { appLabel, customHostname, DEFAULT_LIMITS } from "@cira/core";
import {
  CloudflareError,
  CloudflareHostnames,
  cloudflareConfigFromEnv,
  type HostnameStatus,
} from "@cira/deploy";
import { proxyConfig } from "@/lib/proxy-config";

/**
 * A company's own hostname for an app: `tools.acme.com` rather than
 * `tools--acme.cira.dev`.
 *
 * The name is theirs and so is its DNS; Cira's part is to have Cloudflare
 * issue it a certificate and to tell the app proxy which app it opens. It
 * opens exactly as the app's own address does - the same sign-in through Cira,
 * the same people - because the proxy treats it as another name for the same
 * app, never as a way around who may use it.
 */

/** The Worker every hostname is served by. */
const PROXY_SCRIPT = "cira-app-proxy";

/** A name never pointed at Cira is let go after this, so it cannot be squatted. */
const PENDING_FOR_MS = 7 * 24 * 3600 * 1000;

/** An active name is looked at again this often, in case its DNS moved away. */
const RECHECK_ACTIVE_MS = 24 * 3600 * 1000;

export interface AppDomain {
  hostname: string;
  state: "pending" | "active" | "failed";
  reason: string | null;
  createdAt: Date;
}

function cloudflare(): CloudflareHostnames | null {
  const config = cloudflareConfigFromEnv();
  return config === null ? null : new CloudflareHostnames(config);
}

/** Whether this Cira can give apps their own names. */
export function canUseDomains(): boolean {
  return cloudflareConfigFromEnv() !== null;
}

/** What a company's CNAME has to point at. */
export function domainTarget(): string | null {
  return cloudflareConfigFromEnv()?.target ?? null;
}

export async function listDomains(appId: string): Promise<AppDomain[]> {
  return db()
    .select({
      hostname: appDomains.hostname,
      state: appDomains.state,
      reason: appDomains.reason,
      createdAt: appDomains.createdAt,
    })
    .from(appDomains)
    .where(eq(appDomains.appId, appId))
    .orderBy(asc(appDomains.createdAt));
}

type Outcome<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : T))
  | {
      ok: false;
      error: string;
    };

export async function addDomain(args: {
  appId: string;
  userId: string;
  input: string;
}): Promise<Outcome<{ domain: AppDomain }>> {
  const client = cloudflare();
  if (client === null) {
    return { ok: false, error: "This Cira cannot give apps their own names yet." };
  }
  const checked = customHostname(args.input, proxyConfig().appsDomain);
  if (!checked.ok) return { ok: false, error: checked.reason };
  const { hostname } = checked;

  const database = db();
  const [taken] = await database
    .select({ appId: appDomains.appId })
    .from(appDomains)
    .where(eq(appDomains.hostname, hostname))
    .limit(1);
  if (taken !== undefined) {
    return {
      ok: false,
      error:
        taken.appId === args.appId
          ? `${hostname} is already this app's.`
          : `${hostname} already opens another app on Cira.`,
    };
  }

  const [held] = await database
    .select({ n: count() })
    .from(appDomains)
    .where(eq(appDomains.appId, args.appId));
  if ((held?.n ?? 0) >= DEFAULT_LIMITS.app.domains) {
    return {
      ok: false,
      error: `An app can answer on ${DEFAULT_LIMITS.app.domains} names of its own. Remove one first.`,
    };
  }

  let status: HostnameStatus;
  try {
    // Cheap when already done, and the first name ever added is the moment
    // it has to be.
    await client.ensureZone(PROXY_SCRIPT);
    status = await client.create(hostname);
  } catch (error) {
    return { ok: false, error: domainFailure(error, hostname) };
  }

  const domain: AppDomain = {
    hostname,
    state: status.state,
    reason: status.reason,
    createdAt: new Date(),
  };
  await database.insert(appDomains).values({
    hostname,
    appId: args.appId,
    externalId: status.id,
    state: status.state,
    reason: status.reason,
    createdByUserId: args.userId,
  });
  return { ok: true, domain };
}

export async function removeDomain(appId: string, hostname: string): Promise<Outcome> {
  const [row] = await db()
    .select({ externalId: appDomains.externalId })
    .from(appDomains)
    .where(and(eq(appDomains.appId, appId), eq(appDomains.hostname, hostname)))
    .limit(1);
  if (row === undefined) return { ok: true };

  const client = cloudflare();
  if (client === null) {
    return { ok: false, error: "This Cira cannot reach Cloudflare to let the name go." };
  }
  try {
    await client.remove(row.externalId);
  } catch (error) {
    return { ok: false, error: domainFailure(error, hostname) };
  }
  await db().delete(appDomains).where(eq(appDomains.hostname, hostname));
  return { ok: true };
}

/** Every name the app has, let go before the app is forgotten. */
export async function removeAppDomains(appId: string): Promise<Outcome> {
  for (const domain of await listDomains(appId)) {
    const removed = await removeDomain(appId, domain.hostname);
    if (!removed.ok) return removed;
  }
  return { ok: true };
}

/**
 * The app a hostname opens, as the proxy knows apps: by label. Only a name
 * whose certificate is issued - one that is pending is not the company's yet
 * as far as anyone has proved.
 */
export async function labelForDomain(hostname: string): Promise<string | null> {
  const [row] = await db()
    .select({ appSlug: apps.slug, spaceSlug: spaces.slug })
    .from(appDomains)
    .innerJoin(apps, eq(apps.id, appDomains.appId))
    .innerJoin(spaces, eq(spaces.id, apps.spaceId))
    .where(
      and(
        eq(appDomains.hostname, hostname.toLowerCase()),
        eq(appDomains.state, "active"),
      ),
    )
    .limit(1);
  return row === undefined ? null : appLabel(row);
}

/** The name an app is opened at, when it has an active one of its own. */
export async function primaryDomain(appId: string): Promise<string | null> {
  const [row] = await db()
    .select({ hostname: appDomains.hostname })
    .from(appDomains)
    .where(and(eq(appDomains.appId, appId), eq(appDomains.state, "active")))
    .orderBy(asc(appDomains.createdAt))
    .limit(1);
  return row?.hostname ?? null;
}

/** Whether this hostname is an active name of this app. */
export async function isAppDomain(appId: string, hostname: string): Promise<boolean> {
  const [row] = await db()
    .select({ hostname: appDomains.hostname })
    .from(appDomains)
    .where(
      and(
        eq(appDomains.appId, appId),
        eq(appDomains.hostname, hostname.toLowerCase()),
        eq(appDomains.state, "active"),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Bring every name up to date with Cloudflare, for the watcher: pending ones
 * each pass, active ones once a day. A name pending for a week is let go, so
 * nobody can hold a company's name by adding it first.
 */
export async function refreshDomains(
  now: Date,
  /** Only this app's, for its page: someone waiting on a name looks there. */
  appId?: string,
): Promise<{ checked: number; released: number }> {
  const client = cloudflare();
  if (client === null) return { checked: 0, released: 0 };

  const database = db();
  const rows = await database
    .select()
    .from(appDomains)
    .where(appId === undefined ? undefined : eq(appDomains.appId, appId));
  const due = rows.filter(
    (row) =>
      row.state !== "active" ||
      row.checkedAt.getTime() < now.getTime() - RECHECK_ACTIVE_MS,
  );

  let released = 0;
  for (const row of due) {
    const status = await client.get(row.externalId).catch(() => undefined);
    if (status === undefined) continue;
    const stale =
      row.state !== "active" && row.createdAt.getTime() < now.getTime() - PENDING_FOR_MS;
    if (status === null || (stale && status.state !== "active")) {
      if (status !== null) await client.remove(row.externalId).catch(() => undefined);
      await database.delete(appDomains).where(eq(appDomains.hostname, row.hostname));
      released += 1;
      continue;
    }
    await database
      .update(appDomains)
      .set({ state: status.state, reason: status.reason, checkedAt: now })
      .where(eq(appDomains.hostname, row.hostname));
  }
  return { checked: due.length, released };
}

function domainFailure(error: unknown, hostname: string): string {
  if (error instanceof CloudflareError) {
    if (error.code === 1406 || /duplicate/i.test(error.message)) {
      return `${hostname} is already in use on Cloudflare by someone else.`;
    }
    if (error.status === 403) {
      return "Cira is not allowed to add names on Cloudflare. Tell whoever runs Cira.";
    }
  }
  return "Cloudflare did not answer. Try again in a minute.";
}
