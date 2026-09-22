import { listBody, parseUser } from "@/lib/scim-protocol";
import { createUser, listUsers, userResource } from "@/lib/scim";
import { bodyOf, paging, scim, scimRoute } from "@/lib/scim-http";

/** The company's people, as its identity provider pushed them. */
export function GET(request: Request) {
  return scimRoute(request, async ({ spaceId, origin, url }) => {
    const { filter, startIndex, limit } = paging(url);
    const { rows, total } = await listUsers(spaceId, filter, startIndex, limit);
    return scim(
      listBody(
        rows.map((row) => userResource(row, origin)),
        total,
        startIndex,
      ),
    );
  });
}

export function POST(request: Request) {
  return scimRoute(request, async ({ spaceId, origin }) => {
    const row = await createUser(spaceId, parseUser(await bodyOf(request)));
    return scim(userResource(row, origin), 201);
  });
}
