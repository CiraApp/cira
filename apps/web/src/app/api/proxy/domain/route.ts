import { NextResponse } from "next/server";
import { z } from "zod";
import { labelForDomain } from "@/lib/app-domains";
import { fromProxy, proxyConfig } from "@/lib/proxy-config";

/**
 * Which app a company's own hostname opens, for the app proxy.
 *
 * The proxy knows apps by label - `ledger--acme` - because that is what their
 * Cira addresses are. A request for `tools.acme.com` arrives with no label in
 * it, so the proxy asks, once, and from then on treats the name exactly as it
 * treats the app's own address: the same sign-in through Cira, the same people.
 *
 * Only the proxy may ask. The answer is not secret, but a mapping of every
 * company's hostnames to their apps is not something to hand to anyone who
 * guesses the route.
 */

const body = z.object({ hostname: z.string().min(3).max(253) });

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

  const label = await labelForDomain(parsed.data.hostname);
  return label === null
    ? NextResponse.json({ error: "No app at this address" }, { status: 404 })
    : NextResponse.json({ label });
}
