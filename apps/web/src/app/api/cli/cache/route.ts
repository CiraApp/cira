import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { apps, db, spaces } from "@cira/db";
import { userManages } from "@/lib/app-rights";
import { userFromRequest } from "@/lib/cli-session";
import { cacheUrl } from "@/lib/app-caches";

/**
 * Where an app's cache is, for `cira cache url`.
 *
 * For looking inside it with redis-cli, or clearing it by hand. Cira keeps no
 * address, so this asks Upstash at the moment it is wanted.
 *
 * Managers only - the people who could already deploy code that prints it.
 * Never cached: the answer is a password.
 */
export async function GET(request: Request) {
  const user = await userFromRequest(request);
  if (user === null) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // By id from a linked folder, or by its space and address when named.
  const params = new URL(request.url).searchParams;
  const appId = params.get("appId");
  const spaceSlug = params.get("space");
  const appSlug = params.get("app");
  const where =
    appId !== null && appId.length <= 64
      ? eq(apps.id, appId)
      : spaceSlug !== null && appSlug !== null
        ? and(eq(spaces.slug, spaceSlug), eq(apps.slug, appSlug))
        : null;
  if (where === null) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const [found] = await db()
    .select({ app: apps })
    .from(apps)
    .innerJoin(spaces, eq(spaces.id, apps.spaceId))
    .where(where)
    .limit(1);
  const app = found?.app;
  if (app === undefined || !(await userManages(user, app))) {
    return NextResponse.json({ error: "No such app" }, { status: 404 });
  }

  let address;
  try {
    address = await cacheUrl(app.id);
  } catch {
    return NextResponse.json(
      { error: "Upstash, where the cache is, did not answer. Try again in a minute." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
  if (address === null) {
    return NextResponse.json(
      { error: `${app.name} has no cache made by Cira.` },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }
  return NextResponse.json(address, { headers: { "cache-control": "no-store" } });
}
