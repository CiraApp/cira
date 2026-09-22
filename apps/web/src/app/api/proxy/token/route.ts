import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apps, db, spaces } from "@cira/db";
import { parseAppLabel } from "@cira/core";
import { deploymentProvider } from "@cira/deploy";
import { servingDeployment } from "@/lib/queries";
import { proxyConfig, fromProxy } from "@/lib/proxy-config";

export const maxDuration = 30;

/**
 * Gives the proxy what it needs to reach one app.
 *
 * Deliberately says nothing about people. By the time the proxy asks, it has
 * already checked the session token Cira issued and decided this person may be
 * here; what it lacks is the credential to talk to Google, which only Cira can
 * mint. So the question is "how do I reach this app", not "may they".
 *
 * Which makes who may ask the whole of the security here. The answer that
 * comes back opens an app directly, without going through the proxy at all, so
 * it is not something a browser may ever request. Only the proxy can, and it
 * proves that with the secret it already shares for checking signatures.
 */

const body = z.object({ label: z.string().min(3).max(63) });

export async function POST(request: Request) {
  let config;
  try {
    config = proxyConfig();
  } catch {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  if (!fromProxy(request, config)) {
    return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const address = parseAppLabel(parsed.data.label);
  if (address === null) {
    return NextResponse.json({ error: "No such app" }, { status: 404 });
  }

  const [row] = await db()
    .select({ id: apps.id })
    .from(apps)
    .innerJoin(spaces, eq(spaces.id, apps.spaceId))
    .where(and(eq(spaces.slug, address.spaceSlug), eq(apps.slug, address.appSlug)))
    .limit(1);

  if (row === undefined) {
    return NextResponse.json({ error: "No such app" }, { status: 404 });
  }

  // The build that is serving, not the newest attempt: a deploy that failed
  // or is still going out takes no traffic, and asking only the newest shut
  // every app out of its own proxy from the moment a redeploy failed.
  const deployment = await servingDeployment(row.id);
  if (deployment === null || deployment.url === null) {
    return NextResponse.json({ error: "That app is not running" }, { status: 409 });
  }

  try {
    const token = await deploymentProvider().invocationToken(deployment.url);
    return NextResponse.json({ token, origin: new URL(deployment.url).origin });
  } catch {
    return NextResponse.json({ error: "Could not reach the app" }, { status: 502 });
  }
}
