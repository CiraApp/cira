import "server-only";

import { eq } from "drizzle-orm";
import { appCaches, db } from "@cira/db";
import { UpstashCaches, UpstashError, upstashConfigFromEnv } from "@cira/deploy";
import { ENV_NAME } from "@/lib/env-vars";

/**
 * An app's own Redis cache, made on Upstash when its deploy asks for one - the
 * same arrangement as its database (lib/app-databases.ts): made during the
 * deploy so the address goes out with the rest of the app's variables, and
 * deleted with the app.
 */

export interface AppCache {
  envName: string;
  region: string;
  createdAt: Date;
}

function upstash(): UpstashCaches | null {
  const config = upstashConfigFromEnv();
  return config === null ? null : new UpstashCaches(config);
}

export async function appCache(appId: string): Promise<AppCache | null> {
  const [row] = await db()
    .select({
      envName: appCaches.envName,
      region: appCaches.region,
      createdAt: appCaches.createdAt,
    })
    .from(appCaches)
    .where(eq(appCaches.appId, appId))
    .limit(1);
  return row ?? null;
}

export type CacheForDeploy =
  | { ok: true; created: boolean; envName: string; env: Record<string, string> }
  | { ok: false; error: string };

/** The app's cache, made now if it has none, with the variable that points at it. */
export async function cacheForDeploy(args: {
  appId: string;
  spaceSlug: string;
  appSlug: string;
  userId: string;
  envName: string;
}): Promise<CacheForDeploy> {
  if (!ENV_NAME.test(args.envName)) {
    return { ok: false, error: "That is not a usable variable name for a cache." };
  }
  const client = upstash();
  if (client === null) {
    return {
      ok: false,
      error:
        "This Cira cannot make caches yet. Set the variable yourself to use one you have.",
    };
  }

  const database = db();
  const [existing] = await database
    .select()
    .from(appCaches)
    .where(eq(appCaches.appId, args.appId))
    .limit(1);

  try {
    if (existing !== undefined) {
      return {
        ok: true,
        created: false,
        envName: existing.envName,
        env: { [existing.envName]: await client.url(existing.externalId) },
      };
    }
    const made = await client.create(`${args.spaceSlug}-${args.appSlug}`);
    await database.insert(appCaches).values({
      appId: args.appId,
      provider: "upstash",
      externalId: made.id,
      envName: args.envName,
      region: upstashConfigFromEnv()!.region,
      createdByUserId: args.userId,
    });
    return {
      ok: true,
      created: true,
      envName: args.envName,
      env: { [args.envName]: made.url },
    };
  } catch (error) {
    return { ok: false, error: cacheFailure(error) };
  }
}

/** The address, asked of Upstash for someone who manages the app. */
export async function cacheUrl(
  appId: string,
): Promise<{ envName: string; url: string } | null> {
  const client = upstash();
  const [row] = await db()
    .select()
    .from(appCaches)
    .where(eq(appCaches.appId, appId))
    .limit(1);
  if (client === null || row === undefined) return null;
  return { envName: row.envName, url: await client.url(row.externalId) };
}

/** Delete the app's cache, before the app's row goes. */
export async function removeAppCache(
  appId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [row] = await db()
    .select({ externalId: appCaches.externalId })
    .from(appCaches)
    .where(eq(appCaches.appId, appId))
    .limit(1);
  if (row === undefined) return { ok: true };
  const client = upstash();
  if (client === null) {
    return {
      ok: false,
      error: "This app has a cache, and this Cira cannot reach Upstash to delete it.",
    };
  }
  try {
    await client.remove(row.externalId);
  } catch (error) {
    return { ok: false, error: cacheFailure(error) };
  }
  await db().delete(appCaches).where(eq(appCaches.appId, appId));
  return { ok: true };
}

function cacheFailure(error: unknown): string {
  // Upstash's own words for a full plan, as measured: "You cannot have more
  // than 1 database(s). You can add a payment method ..." - no "limit" in it.
  if (
    error instanceof UpstashError &&
    /limit|more than \d+ database|payment method/i.test(error.message)
  ) {
    return "Cira has made as many caches as its Upstash plan allows. Tell whoever runs Cira.";
  }
  return "Upstash, where Cira makes caches, did not answer. Try again in a minute.";
}
