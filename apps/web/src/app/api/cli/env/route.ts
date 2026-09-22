import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { apps, db } from "@cira/db";
import { userManages } from "@/lib/app-rights";
import { userFromRequest } from "@/lib/cli-session";
import { listEnvVars } from "@/lib/env-vars";

/**
 * The names of the variables an app already has in production.
 *
 * Names only: there are no values to return, because Cira keeps none. What
 * this is for is the CLI's checklist. A deploy now changes only what it sends,
 * so a teammate's fresh clone with no `.env` is not missing `DATABASE_URL` -
 * production already has it - and must not be asked for it, or told the app
 * may not work without it.
 *
 * Managers only, the same people who may see the list on the app page.
 */
export async function GET(request: Request) {
  const user = await userFromRequest(request);
  if (user === null) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const appId = new URL(request.url).searchParams.get("appId");
  if (appId === null || appId.length > 64) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const [app] = await db().select().from(apps).where(eq(apps.id, appId)).limit(1);
  if (app === undefined || !(await userManages(user, app))) {
    return NextResponse.json({ error: "No such app" }, { status: 404 });
  }

  const names = (await listEnvVars(app.id)).map((v) => v.key);
  return NextResponse.json({ names });
}
