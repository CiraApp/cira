import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apps, db, memberships } from "@cira/db";
import { userFromRequest } from "@/lib/cli-session";
import { verifyAppCapabilities } from "@/lib/capability-verification";

/**
 * Ask the app whether the capabilities credited to it are real.
 *
 * Analysis reads source and reasons about it, which is the part that can be
 * wrong. This is the part that cannot: the app is the only thing that knows
 * for certain which paths it serves, and a capability it will not answer for
 * is one an agent would call and get a 404 from.
 *
 * Called once the deployment is live, because that is the earliest the app has
 * its real environment. Reads are invoked; writes are only asked which methods
 * they allow, which cannot change anything.
 */
export const maxDuration = 120;

const body = z.object({ appId: z.string().min(1).max(64) });

export async function POST(request: Request) {
  const user = await userFromRequest(request);
  if (user === null) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const [app] = await db()
    .select({ id: apps.id })
    .from(apps)
    .innerJoin(memberships, eq(memberships.spaceId, apps.spaceId))
    .where(and(eq(apps.id, parsed.data.appId), eq(memberships.userId, user.id)))
    .limit(1);

  if (app === undefined) {
    return NextResponse.json({ error: "No such app" }, { status: 404 });
  }

  const outcome = await verifyAppCapabilities(app.id);

  if (!outcome.ok) {
    return outcome.reason === "not-running"
      ? NextResponse.json({ error: "That app is not running" }, { status: 409 })
      : NextResponse.json({ error: "Could not reach the app" }, { status: 502 });
  }

  return NextResponse.json({
    verified: outcome.verified,
    rejected: outcome.rejected,
    inconclusive: outcome.inconclusive,
  });
}
