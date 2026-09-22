import { describe, expect, it } from "vitest";
import {
  parseFilter,
  parseGroup,
  parseGroupPatch,
  parseUser,
  parseUserPatch,
  ScimError,
} from "./scim-protocol";

describe("SCIM as Okta and Entra send it", () => {
  it("reads a user, by userName or by their primary email", () => {
    expect(
      parseUser({
        userName: "Dana@Acme.com",
        externalId: "00u1",
        name: { givenName: "Dana", familyName: "Wu" },
      }),
    ).toEqual({
      userName: "dana@acme.com",
      externalId: "00u1",
      givenName: "Dana",
      familyName: "Wu",
      active: true,
    });
    // Entra can send an object id as userName and the address in emails.
    expect(
      parseUser({
        userName: "4f3c-9a",
        emails: [{ value: "bo@acme.com", primary: true }],
        active: "False",
      }),
    ).toMatchObject({ userName: "bo@acme.com", active: false });
    expect(() => parseUser({ userName: "no-address" })).toThrow(ScimError);
  });

  it("deactivates the way Okta says it and the way Entra says it", () => {
    expect(
      parseUserPatch({ Operations: [{ op: "replace", value: { active: false } }] }),
    ).toEqual({ active: false });
    expect(
      parseUserPatch({ Operations: [{ op: "Replace", path: "active", value: "False" }] }),
    ).toEqual({ active: false });
  });

  it("takes a rename, and ignores what Cira does not keep", () => {
    expect(
      parseUserPatch({
        Operations: [
          { op: "replace", path: "name.givenName", value: "Dee" },
          { op: "add", path: "title", value: "Engineer" },
        ],
      }),
    ).toEqual({ givenName: "Dee" });
  });

  it("reads group members added, removed and replaced, in both dialects", () => {
    expect(parseGroup({ displayName: "Finance", members: [{ value: "u1" }] })).toEqual({
      displayName: "Finance",
      externalId: null,
      members: ["u1"],
    });
    expect(
      parseGroupPatch({
        Operations: [
          { op: "add", path: "members", value: [{ value: "u2" }] },
          { op: "Remove", path: 'members[value eq "u1"]' },
          { op: "replace", value: { displayName: "Finance EU" } },
        ],
      }),
    ).toEqual({ displayName: "Finance EU", add: ["u2"], remove: ["u1"] });
    expect(
      parseGroupPatch({
        Operations: [{ op: "replace", path: "members", value: [{ value: "u3" }] }],
      }),
    ).toEqual({ add: [], remove: [], replace: ["u3"] });
  });

  it("understands the one filter identity providers send, and refuses the rest", () => {
    expect(parseFilter('userName eq "dana@acme.com"')).toEqual({
      attribute: "username",
      value: "dana@acme.com",
    });
    expect(parseFilter(null)).toBeNull();
    expect(() => parseFilter('userName sw "d"')).toThrow(ScimError);
  });
});
