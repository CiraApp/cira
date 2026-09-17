import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apps, db, memberships } from "@cira/db";
import { userFromRequest } from "@/lib/cli-session";
import { analyzeAppSource } from "@/lib/capability-analysis";

/**
 * Work out what a deployed app can do.
 *
 * Cira reads the source itself, from the archive the CLI already uploaded to
 * build from. Nothing is sent twice and nothing is kept: the bytes are fetched,
 * unpacked in memory, read once by the analyzer and dropped.
 *
 * It used to take a summary the CLI had built - which routes existed, which
 * functions mattered, the first 900 characters of each. That summary was
 * Next.js-shaped, so an app written in anything else arrived empty, and no
 * amount of analysis afterwards could recover what was never sent.
 *
 * This runs while the build is still going out, so it costs the developer no
 * extra waiting. Nothing it finds is published yet: capabilities are stored
 * unverified, and the deployed app is asked to confirm them once it is live.
 */
export const maxDuration = 300;

const body = z.object({
  appId: z.string().min(1).max(64),
  /** The archive this deploy was built from. */
  sourceId: z.string().regex(/^src_[0-9a-f]{32}$/),
});

export async function POST(request: Request) {
  const user = await userFromRequest(request);
  if (user === null) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  // Analysis writes to the app, so it takes the same membership the deploy
  // did. An app the caller is not in reads as one that does not exist.
  const [app] = await db()
    .select({
      id: apps.id,
      name: apps.name,
      spaceId: apps.spaceId,
      description: apps.description,
    })
    .from(apps)
    .innerJoin(memberships, eq(memberships.spaceId, apps.spaceId))
    .where(and(eq(apps.id, parsed.data.appId), eq(memberships.userId, user.id)))
    .limit(1);

  if (app === undefined) {
    return NextResponse.json({ error: "No such app" }, { status: 404 });
  }

  const outcome = await analyzeAppSource({
    app,
    userId: user.id,
    sourceId: parsed.data.sourceId,
  });

  if (!outcome.ok) {
    return NextResponse.json(
      { error: outcome.error },
      { status: outcome.reason === "source" ? 404 : 502 },
    );
  }

  // Deliberately no count of what is enabled. Nothing is, yet: these are
  // registered unverified, and whether any of them can be used is settled by
  // the app itself a moment later. Reporting the policy's answer here would
  // have said "3 enabled" about three capabilities nobody could call.
  //
  // What was read is said plainly, because an analysis that only saw half a
  // repository is worth knowing about when the answer looks thin.
  return NextResponse.json({
    detected: outcome.detected.map((c) => ({
      name: c.name,
      description: c.description,
      risk: c.risk,
    })),
    read: outcome.read,
    skipped: outcome.skipped,
  });
}
