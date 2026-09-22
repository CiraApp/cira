import { listBody } from "@/lib/scim-protocol";
import { scim, scimRoute } from "@/lib/scim-http";

export function GET(request: Request) {
  return scimRoute(request, async () =>
    scim(
      listBody(
        [
          {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
            id: "User",
            name: "User",
            endpoint: "/Users",
            schema: "urn:ietf:params:scim:schemas:core:2.0:User",
          },
          {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
            id: "Group",
            name: "Group",
            endpoint: "/Groups",
            schema: "urn:ietf:params:scim:schemas:core:2.0:Group",
          },
        ],
        2,
        1,
      ),
    ),
  );
}
