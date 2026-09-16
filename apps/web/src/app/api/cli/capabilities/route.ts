import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apps, db, memberships } from "@cira/db";
import { packSource, sourceStore, tarUngzip } from "@cira/deploy";
import { userFromRequest } from "@/lib/cli-session";
import { analyzeCapabilities } from "@/lib/capability-analyzer";
import { replaceCapabilities } from "@/lib/capabilities";

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

  const store = sourceStore();
  const stored = await store.find({ userId: user.id, sourceId: parsed.data.sourceId });
  if (stored === null) {
    return NextResponse.json({ error: "That upload is not there" }, { status: 404 });
  }

  let source;
  try {
    source = packSource(tarUngzip(await store.download(stored)));
  } catch {
    return NextResponse.json({ error: "Could not read that upload" }, { status: 400 });
  }

  const result = await analyzeCapabilities(source.text, { appName: app.name });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  // Written once and then left alone. A description someone has edited is a
  // human decision, and a later deploy re-running the analyzer is not a reason
  // to overwrite it - which is also why this checks the column rather than
  // tracking a flag nobody would remember to set.
  if (
    result.summary !== "" &&
    (app.description === null || app.description.trim() === "")
  ) {
    await db()
      .update(apps)
      .set({ description: result.summary, updatedAt: new Date() })
      .where(eq(apps.id, app.id));
  }

  await replaceCapabilities({
    appId: app.id,
    spaceId: app.spaceId,
    detected: result.capabilities,
  });

  // Deliberately no count of what is enabled. Nothing is, yet: these are
  // registered unverified, and whether any of them can be used is settled by
  // the app itself a moment later. Reporting the policy's answer here would
  // have said "3 enabled" about three capabilities nobody could call.
  return NextResponse.json({
    detected: result.capabilities.map((c) => ({
      name: c.name,
      description: c.description,
      risk: c.risk,
    })),
    // Said plainly, because an analysis that only saw half a repository is
    // worth knowing about when the answer looks thin.
    read: source.included.length,
    skipped: source.omitted.length,
  });
}
