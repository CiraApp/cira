import "server-only";

import { NextResponse } from "next/server";
import { errorBody, parseFilter, ScimError } from "@/lib/scim-protocol";
import { spaceForToken } from "@/lib/scim";

/**
 * Every SCIM route, the same way: the bearer token names the space, errors
 * come back in SCIM's own shape, and everything is `application/scim+json`,
 * which some identity providers insist on.
 */

const TYPE = { "content-type": "application/scim+json" };

export function scim(body: unknown, status = 200): NextResponse {
  return status === 204
    ? new NextResponse(null, { status })
    : NextResponse.json(body, { status, headers: TYPE });
}

export async function scimRoute(
  request: Request,
  handle: (context: {
    spaceId: string;
    origin: string;
    url: URL;
  }) => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    const spaceId = await spaceForToken(request.headers.get("authorization"));
    if (spaceId === null)
      throw new ScimError(401, "That token is not one Cira issued, or it was replaced.");
    const url = new URL(request.url);
    return await handle({ spaceId, origin: url.origin, url });
  } catch (error) {
    if (error instanceof ScimError) return scim(errorBody(error), error.status);
    throw error;
  }
}

/** A JSON body, or a SCIM error saying it is not one. */
export async function bodyOf(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ScimError(400, "The body is not JSON.", "invalidSyntax");
  }
}

/** `filter`, `startIndex` and `count`, as a list request carries them. */
export function paging(url: URL) {
  const startIndex = Math.max(1, Number(url.searchParams.get("startIndex") ?? 1) || 1);
  const limit = Math.min(
    200,
    Math.max(0, Number(url.searchParams.get("count") ?? 100) || 100),
  );
  return { filter: parseFilter(url.searchParams.get("filter")), startIndex, limit };
}
