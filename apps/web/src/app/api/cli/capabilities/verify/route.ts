import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apps, db, spaces } from "@cira/db";
import { userManages } from "@/lib/app-rights";
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

  // Probing an app is part of shipping it, so it takes what the deploy took:
  // the right to manage it.
  const [row] = await db()
    .select()
    .from(apps)
    .where(eq(apps.id, parsed.data.appId))
    .limit(1);
  const app = row !== undefined && (await userManages(user, row)) ? row : undefined;

  if (app === undefined) {
    return NextResponse.json({ error: "No such app" }, { status: 404 });
  }

  const [space] = await db()
    .select({ slug: spaces.slug })
    .from(spaces)
    .where(eq(spaces.id, app.spaceId))
    .limit(1);
  // The CLI asks this once a deploy is live, so what worked under the last
  // build is asked about again - as the person deploying, for an app that is
  // told who is calling.
  const outcome = await verifyAppCapabilities(
    app.id,
    space === undefined ? undefined : { user, spaceSlug: space.slug },
    { afterDeploy: true },
  );

  if (!outcome.ok) {
    return outcome.reason === "not-running"
      ? NextResponse.json({ error: "That app is not running" }, { status: 409 })
      : NextResponse.json({ error: "Could not reach the app" }, { status: 502 });
  }

  return NextResponse.json({
    callable: outcome.callable,
    refused: outcome.refused,
    absent: outcome.absent,
    // Answered about but not settled, so they wait for a person. An older CLI
    // ignores it, as it ignored `refused`.
    unconfirmed: outcome.unconfirmed,
    inconclusive: outcome.inconclusive,
    // The names the CLI used before there was a third answer. Copies of it are
    // installed on people's machines and cannot be updated from here, and both
    // still mean exactly what they said: how many the app confirmed, and how
    // many it has no route for. An older CLI simply does not mention the
    // refused ones, which is what it did anyway.
    verified: outcome.callable,
    rejected: outcome.absent,
  });
}
