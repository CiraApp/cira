import { parseUser, parseUserPatch } from "@/lib/scim-protocol";
import { deleteUser, getUser, patchUser, replaceUser, userResource } from "@/lib/scim";
import { bodyOf, scim, scimRoute } from "@/lib/scim-http";

type Params = { params: Promise<{ id: string }> };

export function GET(request: Request, { params }: Params) {
  return scimRoute(request, async ({ spaceId, origin }) =>
    scim(userResource(await getUser(spaceId, (await params).id), origin)),
  );
}

export function PUT(request: Request, { params }: Params) {
  return scimRoute(request, async ({ spaceId, origin }) => {
    const row = await replaceUser(
      spaceId,
      (await params).id,
      parseUser(await bodyOf(request)),
    );
    return scim(userResource(row, origin));
  });
}

/** How Okta and Entra deactivate someone: `active` to false. */
export function PATCH(request: Request, { params }: Params) {
  return scimRoute(request, async ({ spaceId, origin }) => {
    const row = await patchUser(
      spaceId,
      (await params).id,
      parseUserPatch(await bodyOf(request)),
    );
    return scim(userResource(row, origin));
  });
}

export function DELETE(request: Request, { params }: Params) {
  return scimRoute(request, async ({ spaceId }) => {
    await deleteUser(spaceId, (await params).id);
    return scim(null, 204);
  });
}
