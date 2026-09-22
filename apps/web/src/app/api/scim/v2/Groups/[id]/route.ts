import { parseGroup, parseGroupPatch } from "@/lib/scim-protocol";
import {
  deleteGroup,
  getGroup,
  groupResource,
  patchGroup,
  replaceGroup,
} from "@/lib/scim";
import { bodyOf, scim, scimRoute } from "@/lib/scim-http";

type Params = { params: Promise<{ id: string }> };

export function GET(request: Request, { params }: Params) {
  return scimRoute(request, async ({ spaceId, origin }) =>
    scim(await groupResource(await getGroup(spaceId, (await params).id), origin)),
  );
}

export function PUT(request: Request, { params }: Params) {
  return scimRoute(request, async ({ spaceId, origin }) => {
    const row = await replaceGroup(
      spaceId,
      (await params).id,
      parseGroup(await bodyOf(request)),
    );
    return scim(await groupResource(row, origin));
  });
}

export function PATCH(request: Request, { params }: Params) {
  return scimRoute(request, async ({ spaceId, origin }) => {
    const row = await patchGroup(
      spaceId,
      (await params).id,
      parseGroupPatch(await bodyOf(request)),
    );
    return scim(await groupResource(row, origin));
  });
}

export function DELETE(request: Request, { params }: Params) {
  return scimRoute(request, async ({ spaceId }) => {
    await deleteGroup(spaceId, (await params).id);
    return scim(null, 204);
  });
}
