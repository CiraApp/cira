import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apps, capabilities, db, memberships } from "@cira/db";
import { deploymentProvider } from "@cira/deploy";
import { userFromRequest } from "@/lib/cli-session";
import { verifyCapabilities } from "@/lib/capability-verify";
import { recordVerification } from "@/lib/capabilities";
import { probeWebUi } from "@/lib/browser-ui";
import { latestDeployment } from "@/lib/queries";

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

  // Only what has not been asked about. A redeploy clears the stamp, so this
  // is everything new plus anything the last deploy changed.
  const pending = await db()
    .select({
      name: capabilities.name,
      method: capabilities.method,
      path: capabilities.path,
      risk: capabilities.risk,
      probe: capabilities.probe,
    })
    .from(capabilities)
    .where(and(eq(capabilities.appId, app.id), isNull(capabilities.verifiedAt)));

  const deployment = await latestDeployment(app.id);
  const url = deployment !== null && deployment.status === "live" ? deployment.url : null;

  // Nothing to ask, and nothing running to ask: the quiet success this has
  // always returned, so a redeploy that changed no capabilities is not an error.
  if (url === null) {
    if (pending.length === 0) {
      return NextResponse.json({ verified: 0, rejected: 0, inconclusive: false });
    }
    return NextResponse.json({ error: "That app is not running" }, { status: 409 });
  }

  let token: string;
  try {
    token = await deploymentProvider().invocationToken(url);
  } catch {
    if (pending.length === 0) {
      return NextResponse.json({ verified: 0, rejected: 0, inconclusive: false });
    }
    return NextResponse.json({ error: "Could not reach the app" }, { status: 502 });
  }

  const origin = new URL(url).origin;

  // Asked on every verify rather than only when capabilities changed, because
  // whether an app has a front door is a fact about the deploy and not about
  // its capabilities: a release that adds a web interface and no new routes
  // should still stop Cira describing it as headless.
  //
  // Null means the app did not answer clearly enough to conclude anything, and
  // then whatever was already known is left alone - including "not yet asked".
  const webUi = await probeWebUi({ origin, token });
  if (webUi !== null) {
    await db()
      .update(apps)
      .set({ hasWebUi: webUi, updatedAt: new Date() })
      .where(eq(apps.id, app.id));
  }

  if (pending.length === 0) {
    return NextResponse.json({ verified: 0, rejected: 0, inconclusive: false });
  }

  const outcome = await verifyCapabilities({
    origin,
    token,
    capabilities: pending.map((row) => ({
      name: row.name,
      method: row.method,
      path: row.path,
      risk: row.risk === "read" ? "read" : "write",
      probe: (row.probe as Record<string, unknown> | null) ?? undefined,
    })),
  });

  // Nothing is recorded when the app answers everything. Stamping capabilities
  // an app confirmed indiscriminately would be worse than leaving them off.
  if (!outcome.inconclusive) {
    await recordVerification({
      appId: app.id,
      verified: outcome.verified,
      rejected: outcome.rejected,
    });
  }

  return NextResponse.json({
    verified: outcome.verified.length,
    rejected: outcome.rejected.length,
    inconclusive: outcome.inconclusive,
  });
}
