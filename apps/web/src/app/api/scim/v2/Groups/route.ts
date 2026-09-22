import { listBody, parseGroup } from "@/lib/scim-protocol";
import { createGroup, groupResource, listGroups } from "@/lib/scim";
import { bodyOf, paging, scim, scimRoute } from "@/lib/scim-http";

/** The company's groups, each kept as a Cira team. */
export function GET(request: Request) {
  return scimRoute(request, async ({ spaceId, origin, url }) => {
    const { filter, startIndex, limit } = paging(url);
    const { rows, total } = await listGroups(spaceId, filter, startIndex, limit);
    const resources = await Promise.all(rows.map((row) => groupResource(row, origin)));
    return scim(listBody(resources, total, startIndex));
  });
}

export function POST(request: Request) {
  return scimRoute(request, async ({ spaceId, origin }) => {
    const row = await createGroup(spaceId, parseGroup(await bodyOf(request)));
    return scim(await groupResource(row, origin), 201);
  });
}
