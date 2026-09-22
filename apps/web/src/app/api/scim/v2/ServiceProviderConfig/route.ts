import { scim, scimRoute } from "@/lib/scim-http";

/** What Cira's SCIM does, for identity providers that ask before pushing. */
export function GET(request: Request) {
  return scimRoute(request, async () =>
    scim({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
      documentationUri: "https://cira.dev/docs",
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 200 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: "oauthbearertoken",
          name: "Bearer token",
          description: "The token made in the space's settings on Cira.",
          primary: true,
        },
      ],
    }),
  );
}
