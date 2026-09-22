import { NextResponse } from "next/server";
import {
  parseAppLabel,
  signSession,
  SESSION_SECONDS,
  isSafeTargetPath,
} from "@cira/core";
import { NotFoundError, requireAppAccess } from "@/lib/authz";
import { latestDeployment, recordAppOpen, servingDeployment } from "@/lib/queries";
import { isAppDomain, primaryDomain } from "@/lib/app-domains";
import { proxyConfig } from "@/lib/proxy-config";
import { resolveAppState } from "@/lib/app-state";

/**
 * Where opening an app begins.
 *
 * A deployed app lives on its own hostname, which means it has its own cookies
 * and knows nothing about whoever is signed in to Cira. So the browser is sent
 * here first, on Cira's own domain, where the session already exists: this
 * checks that this person may open this app, and hands back a short-lived
 * token for that app alone. The proxy in front of the app trusts the token and
 * nothing else.
 *
 * Deliberately not a redirect the proxy could have made itself. Only Cira
 * knows who someone is, and only Cira knows who may open what; the proxy is
 * left with a signature to check.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ label: string }> },
) {
  const { label } = await params;
  const origin = new URL(request.url).origin;
  const address = parseAppLabel(label);

  if (address === null) return NextResponse.redirect(new URL("/", origin));

  const home = new URL(`/${address.spaceSlug}/${address.appSlug}`, origin);

  try {
    // The same check the app's page makes. Someone who cannot see the app gets
    // the same answer here as anywhere else: it does not exist.
    const ctx = await requireAppAccess(address.spaceSlug, address.appSlug);
    const deployment = await latestDeployment(ctx.app.id);
    // A live deployment is the precondition; where a browser goes is this
    // route's own answer, so the address is not asked of it here.
    const resolved = resolveAppState(
      ctx.app,
      deployment,
      `/enter/${label}`,
      await servingDeployment(ctx.app.id),
    );

    // Nothing to open is not a permission problem, so it goes back to the page
    // that explains which of the several reasons it is.
    if (resolved.state !== "live") return NextResponse.redirect(home);

    const { appsDomain, secret } = proxyConfig();
    const token = await signSession(
      {
        userId: ctx.user.id,
        appId: ctx.app.id,
        label,
        expiresAt: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
      },
      secret,
    );

    // Recorded here rather than on the app page, because this is the moment
    // someone actually used the app rather than looked at it.
    await recordAppOpen(ctx.user.id, ctx.app.id);

    // Where to land inside the app. Checked rather than trusted: it arrives in
    // a query parameter, and an unchecked one is an open redirect wearing a
    // different hat.
    const asked = new URL(request.url).searchParams.get("next") ?? "/";
    const next = isSafeTargetPath(asked) ? asked : "/";

    // Which name to hand the session to. The one the person came from, when
    // it is one of this app's own - a token is only ever sent to a name the
    // app has proved is its - otherwise the name the app is opened at, then
    // its Cira address.
    const from = new URL(request.url).searchParams.get("host");
    const host =
      from !== null && (await isAppDomain(ctx.app.id, from))
        ? from.toLowerCase()
        : ((await primaryDomain(ctx.app.id)) ?? `${label}.${appsDomain}`);
    const handover = new URL(`https://${host}/__cira/enter`);
    handover.searchParams.set("t", token);
    handover.searchParams.set("next", next);

    return NextResponse.redirect(handover);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.redirect(new URL(`/${address.spaceSlug}`, origin));
    }
    // An unconfigured proxy is a deployment problem, not this person's, and
    // the app page says plainly that opening apps is unavailable.
    if (error instanceof Error && error.message.includes("not configured")) {
      return NextResponse.redirect(home);
    }
    throw error;
  }
}
