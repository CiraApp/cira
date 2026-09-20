import { NextResponse } from "next/server";
import { publicJwks } from "@/lib/identity-assertion";

/**
 * The keys an app verifies Cira's identity assertions with.
 *
 * Public by definition, and cached: an app fetching this on every request
 * would be a worse thing than the problem it solves. Both the current key and
 * the one before it are here, so a rotation does not break an app that
 * cached the old one.
 */
export async function GET() {
  return NextResponse.json(publicJwks(), {
    headers: { "cache-control": "public, max-age=3600, stale-while-revalidate=86400" },
  });
}
