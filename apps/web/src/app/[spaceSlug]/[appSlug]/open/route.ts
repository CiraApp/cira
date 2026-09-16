import { NextResponse } from "next/server";
import { NotFoundError, requireAppAccess } from "@/lib/authz";
import { latestDeployment } from "@/lib/queries";
import { resolveAppState } from "@/lib/app-state";

/**
 * The door to a deployed app.
 *
 * Shut, for now. Apps run on Cloud Run, which wants an identity token on every
 * request, and a browser cannot put a header on a navigation. The previous
 * provider accepted a secret as a query parameter and exchanged it for a
 * cookie, which is what this route used to do and why it no longer does
 * anything: there is no equivalent to reach for.
 *
 * The route stays rather than being deleted, because the link to it is in
 * people's history and in Cira's own pages, and landing back on the app page
 * where the reason is written is better than a 404. It asks the same function
 * the page asks, so the two can never disagree about whether an app opens.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ spaceSlug: string; appSlug: string }> },
) {
  const { spaceSlug, appSlug } = await params;
  const origin = new URL(request.url).origin;
  const backToApp = new URL(`/${spaceSlug}/${appSlug}`, origin);

  try {
    const ctx = await requireAppAccess(spaceSlug, appSlug);
    const deployment = await latestDeployment(ctx.app.id);
    const resolved = resolveAppState(ctx.app, deployment);

    if (resolved.openUrl === null) return NextResponse.redirect(backToApp);
    return NextResponse.redirect(new URL(resolved.openUrl));
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.redirect(new URL(`/${spaceSlug}`, origin));
    }
    throw error;
  }
}
