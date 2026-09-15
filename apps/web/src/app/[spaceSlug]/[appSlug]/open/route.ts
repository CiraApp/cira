import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { apps, db } from "@cira/db";
import { NotFoundError, requireAppAccess } from "@/lib/authz";
import { latestDeployment } from "@/lib/queries";
import { resolveAppState } from "@/lib/app-state";

/**
 * The door to a deployed app.
 *
 * Deployed apps are unreachable on their own URL, so this is the only way in
 * and Cira's permission check is what opens it. Employees never need an
 * account with whoever runs the app.
 *
 * The secret travels as a one-time query parameter that the provider
 * immediately exchanges for a cookie. It is briefly visible in the address bar,
 * which is the weak point of this approach; a full proxy would avoid it at the
 * cost of standing between every request and the app.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ spaceSlug: string; appSlug: string }> },
) {
  const { spaceSlug, appSlug } = await params;
  const origin = new URL(request.url).origin;
  const backToApp = new URL(`/${spaceSlug}/${appSlug}`, origin);

  try {
    const { app } = await requireAppAccess(spaceSlug, appSlug);
    const deployment = await latestDeployment(app.id);

    // The secret is infrastructure, not part of the app as the product knows
    // it, so it is read here rather than carried through the domain type.
    const [row] = await db()
      .select({ accessSecret: apps.accessSecret })
      .from(apps)
      .where(eq(apps.id, app.id))
      .limit(1);

    const secret = row?.accessSecret ?? null;

    // Resolved from exactly the inputs the app page uses, so the button and
    // this route can never disagree about whether the app opens.
    const resolved = resolveAppState(app, deployment, secret !== null && secret !== "");
    if (resolved.openUrl === null || secret === null) {
      return NextResponse.redirect(backToApp);
    }

    const target = new URL(resolved.openUrl);
    target.searchParams.set("x-vercel-protection-bypass", secret);
    target.searchParams.set("x-vercel-set-bypass-cookie", "true");

    return NextResponse.redirect(target);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.redirect(new URL(`/${spaceSlug}`, origin));
    }
    throw error;
  }
}
