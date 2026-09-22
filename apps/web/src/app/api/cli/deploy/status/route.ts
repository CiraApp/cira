import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { apps, db, deployments, processes } from "@cira/db";
import { canAccessApp, type AppAccess, type Deployment } from "@cira/core";
import { grantsFor } from "@/lib/app-rights";
import { userFromRequest } from "@/lib/cli-session";
import { reconcileDeployment } from "@/lib/deployment-sync";
import { principalFor } from "@/lib/principal";

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

  // Whoever may open the app may follow its deploy. A member who cannot see
  // it gets the same answer as a deployment that does not exist.
  const principal = await principalFor(user);
  const visible =
    principal !== null &&
    canAccessApp({ principal, app: row.app, access: await grantsFor(row.app.id) });
  if (!visible) {
    return NextResponse.json({ error: "No such deployment" }, { status: 404 });
  }

  // The same reconciliation as every other place a deploy is looked at, so
  // the CLI cannot roll out a deploy that a newer one replaced, and cannot
  // disagree with the app page about how it went.
  const settled = await reconcileDeployment(row.deployment as Deployment);

  // What the terminal says once it is live, from what is true of the app
  // rather than of a first deploy: it used to tell someone redeploying an app
  // shared with the whole company that only they could see it, and that
  // workers already running were off.
  const live =
    settled.status === "live"
      ? {
          access: accessOf(await grantsFor(row.app.id), row.app.ownerUserId),
          processesOff: (
            await database
              .select({ enabled: processes.enabled })
              .from(processes)
              .where(eq(processes.appId, row.app.id))
          ).filter((p) => !p.enabled).length,
        }
      : {};

  return NextResponse.json({
    ...live,
    status: settled.status,
    url: settled.url,
    reason: settled.failureReason,
    warning: settled.warning,
    // Between the build and the rollout, while the migration runs.
    releasing:
      settled.releaseStartedAt !== null &&
      settled.releaseDoneAt === null &&
      (settled.status === "deploying" || settled.status === "building"),
  });
}

/**
 * Who can open the app besides whoever owns it. A new app carries a grant to
 * its owner, which is not sharing it with anybody.
 */
function accessOf(
  grants: readonly AppAccess[],
  ownerId: string,
): "everyone" | "shared" | "private" {
  if (grants.some((grant) => grant.type === "space")) return "everyone";
  const others = grants.filter(
    (grant) => !(grant.type === "user" && grant.targetId === ownerId),
  );
  return others.length > 0 ? "shared" : "private";
}
