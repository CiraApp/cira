import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { apps, db, deployments, memberships } from "@cira/db";
import { deploymentProvider, isTerminal } from "@cira/deploy";
import { userFromRequest } from "@/lib/cli-session";

/**
 * How is a deploy going?
 *
 * The provider is the source of truth while a deploy is in flight, and Cira's
 * own records are brought up to date as a side effect, so the gallery reflects
 * reality without a separate poller.
 */
export async function GET(request: Request) {
  const user = await userFromRequest(request);
  if (user === null) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const id = new URL(request.url).searchParams.get("id");
  if (id === null) {
    return NextResponse.json({ error: "Missing deployment id" }, { status: 400 });
  }

  const database = db();

  const [row] = await database
    .select({ deployment: deployments, app: apps })
    .from(deployments)
    .innerJoin(apps, eq(apps.id, deployments.appId))
    .where(eq(deployments.id, id))
    .limit(1);

  if (row === undefined) {
    return NextResponse.json({ error: "No such deployment" }, { status: 404 });
  }

  const [member] = await database
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), eq(memberships.spaceId, row.app.spaceId)))
    .limit(1);

  if (member === undefined) {
    return NextResponse.json({ error: "No such deployment" }, { status: 404 });
  }

  if (isTerminal(row.deployment.status)) {
    return NextResponse.json({
      status: row.deployment.status,
      url: row.deployment.url,
    });
  }

  let live;
  try {
    live = await deploymentProvider().getStatus(row.deployment.providerDeploymentId);
  } catch {
    // The provider being briefly unreachable is not a failed deploy.
    return NextResponse.json({ status: row.deployment.status, url: row.deployment.url });
  }

  await database
    .update(deployments)
    .set({ status: live.status, url: live.url, updatedAt: new Date() })
    .where(eq(deployments.id, row.deployment.id));

  if (isTerminal(live.status)) {
    await database
      .update(apps)
      .set({
        status: live.status === "live" ? "live" : "failed",
        updatedAt: new Date(),
      })
      .where(eq(apps.id, row.app.id));
  }

  return NextResponse.json({ status: live.status, url: live.url });
}
