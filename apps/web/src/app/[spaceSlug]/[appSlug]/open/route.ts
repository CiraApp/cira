import { NextResponse } from "next/server";
import { appLabel } from "@cira/core";
import { NotFoundError, requireAppAccess } from "@/lib/authz";

/**
 * The door to a deployed app, kept for the links that point at it.
 *
 * Opening an app now starts at `/enter/{label}`, which is on Cira's domain for
 * the same reason this was: only Cira knows who someone is. This forwards
 * there rather than duplicating the check, so there is one place that decides
 * and one place to change.
 *
 * It stays because this path is in people's history and in older pages, and
 * arriving somewhere that works beats a 404.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ spaceSlug: string; appSlug: string }> },
) {
  const { spaceSlug, appSlug } = await params;
  const origin = new URL(request.url).origin;

  try {
    // Checked here too, so this does not become a way to find out which apps
    // exist by watching where it sends you.
    await requireAppAccess(spaceSlug, appSlug);

    const label = appLabel({ appSlug, spaceSlug });
    if (label === null) {
      return NextResponse.redirect(new URL(`/${spaceSlug}/${appSlug}`, origin));
    }

    return NextResponse.redirect(new URL(`/enter/${label}`, origin));
  } catch (error) {
    // The app's page says "not found" and why that can be, as `/enter` does.
    if (error instanceof NotFoundError) {
      return NextResponse.redirect(new URL(`/${spaceSlug}/${appSlug}`, origin));
    }
    throw error;
  }
}
