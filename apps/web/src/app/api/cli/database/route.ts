import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { apps, db, spaces } from "@cira/db";
import { userManages } from "@/lib/app-rights";
import { userFromRequest } from "@/lib/cli-session";
import { databaseUrls } from "@/lib/app-databases";

/**
 * Where an app's database is, for `cira database url`.
 *
 * A database is only half useful if the only thing that can reach it is the
 * app: its managers need it to run a migration by hand, look at a row, or
 * take their data with them when they leave. Cira keeps no address, so this
 * asks Neon for it at the moment it is wanted and passes it straight on.
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

  let urls;
  try {
    urls = await databaseUrls(app.id);
  } catch {
    return NextResponse.json(
      { error: "Neon, where the database is, did not answer. Try again in a minute." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
  if (urls === null) {
    return NextResponse.json(
      { error: `${app.name} has no database made by Cira.` },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }
  return NextResponse.json(urls, { headers: { "cache-control": "no-store" } });
}
