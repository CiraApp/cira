import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { apps, db, deployments } from "@cira/db";
import { canAccessApp } from "@cira/core";
import { deploymentProvider } from "@cira/deploy";
import { grantsFor } from "@/lib/app-rights";
import { userFromRequest } from "@/lib/cli-session";
import { principalFor } from "@/lib/principal";

/**
 * The end of a deploy's build output, for the terminal that started it.
 *
 * A build that failed used to be reported as "its logs, on the app's page,
 * say where", which sends someone at a terminal off to a browser to read what
 * the terminal could have shown. The same people may read it as on the app's
 * page: anyone who may open the app. A build is given no secrets
 * (docs/secrets.md), so its output holds none.
 */

/** Enough to see the error and what led to it. */
const TAIL = 40;

export async function GET(request: Request) {
  const user = await userFromRequest(request);
  if (user === null) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const id = new URL(request.url).searchParams.get("id");
  if (id === null) {
    return NextResponse.json({ error: "Missing deployment id" }, { status: 400 });
  }

  const [row] = await db()
    .select({ deployment: deployments, app: apps })
    .from(deployments)
    .innerJoin(apps, eq(apps.id, deployments.appId))
    .where(eq(deployments.id, id))
    .limit(1);

  const principal = row === undefined ? null : await principalFor(user);
  const visible =
    row !== undefined &&
    principal !== null &&
    canAccessApp({ principal, app: row.app, access: await grantsFor(row.app.id) });
  if (!visible) {
    return NextResponse.json({ error: "No such deployment" }, { status: 404 });
  }

  try {
    const lines = await deploymentProvider().getLogs(row.deployment.providerDeploymentId);
    return NextResponse.json({ lines: lines.slice(-TAIL).map((line) => line.message) });
  } catch {
    return NextResponse.json({ lines: [] });
  }
}
