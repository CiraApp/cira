import { listBody } from "@/lib/scim-protocol";
import { scim, scimRoute } from "@/lib/scim-http";

/** The attributes Cira keeps; anything else a provider sends is accepted and ignored. */
export function GET(request: Request) {
  return scimRoute(request, async () =>
    scim(
      listBody(
        [
          {
            id: "urn:ietf:params:scim:schemas:core:2.0:User",
            name: "User",
            attributes: [
              { name: "userName", type: "string", required: true, uniqueness: "server" },
              { name: "name", type: "complex", required: false },
              { name: "emails", type: "complex", multiValued: true, required: false },
              { name: "active", type: "boolean", required: false },
              { name: "externalId", type: "string", required: false },
            ],
          },
          {
            id: "urn:ietf:params:scim:schemas:core:2.0:Group",
            name: "Group",
            attributes: [
              { name: "displayName", type: "string", required: true },
              { name: "members", type: "complex", multiValued: true, required: false },
              { name: "externalId", type: "string", required: false },
            ],
          },
        ],
        2,
        1,
      ),
    ),
  );
}
