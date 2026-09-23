import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { newId, type User } from "@cira/core";
import type * as CiraDb from "@cira/db";
import { migratedTestDatabase } from "../../../../packages/db/src/test-database.js";

/**
 * SCIM, through its own routes, as Okta and Entra call them - against a real
 * database, with nothing stubbed but which database that is.
 */

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];
const hasDatabase = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== "";

let database: Awaited<ReturnType<typeof migratedTestDatabase>>;
vi.mock("@cira/db", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDb>();
  return { ...actual, db: () => database };
});

const spaceId = newId("space");
const owner = { id: newId("user"), email: "owner@acme.test" };
const dana = { id: newId("user"), email: "dana@acme.test" };
const appId = newId("app");
let token = "";

const call = async (method: string, path: string, body?: unknown, auth = token) => {
  const url = `https://cira.dev/api/scim/v2${path}`;
  const request = new Request(url, {
    method,
    headers: {
      authorization: `Bearer ${auth}`,
      "content-type": "application/scim+json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const [, resource, id] = /^\/(Users|Groups)(?:\/([^?]+))?/.exec(path) ?? [];
  const params = { params: Promise.resolve({ id: id ?? "" }) };
  const route =
    resource === "Users"
      ? id === undefined
        ? await import("@/app/api/scim/v2/Users/route")
        : await import("@/app/api/scim/v2/Users/[id]/route")
      : id === undefined
        ? await import("@/app/api/scim/v2/Groups/route")
        : await import("@/app/api/scim/v2/Groups/[id]/route");
  const handler = (
    route as Record<string, (r: Request, p: typeof params) => Promise<Response>>
  )[method]!;
  const response = await handler(request, params);
  const text = await response.text();
  return { status: response.status, body: text === "" ? null : JSON.parse(text) };
};

const memberOf = async (userId: string) => {
  const { memberships } = await import("@cira/db");
  const [row] = await database
    .select()
    .from(memberships)
    .where(and(eq(memberships.spaceId, spaceId), eq(memberships.userId, userId)));
  return row ?? null;
};

describe.skipIf(!hasDatabase)("SCIM", () => {
  beforeAll(async () => {
    database = await migratedTestDatabase(TEST_DATABASE_URL as string, "cira_scim");
    const { users, spaces, memberships, apps } = await import("@cira/db");
    await database.insert(users).values([
      { id: owner.id, externalId: "x_owner", name: "Owner", email: owner.email },
      { id: dana.id, externalId: "x_dana", name: "Dana", email: dana.email },
    ]);
    await database
      .insert(spaces)
      .values({ id: spaceId, name: "Acme", slug: "acme", domain: "acme.test" });
    await database.insert(memberships).values({
      id: newId("membership"),
      userId: owner.id,
      spaceId,
      role: "owner",
    });
    await database.insert(apps).values({
      id: appId,
      spaceId,
      name: "Ledger",
      slug: "ledger",
      ownerUserId: owner.id,
      status: "live",
    });
    const { issueScimToken } = await import("./scim");
    token = await issueScimToken(spaceId, owner.id);
  });

  afterAll(async () => {
    await database?.end();
  });

  it("answers nothing to a token Cira did not issue, in SCIM's own words", async () => {
    const { status, body } = await call("GET", "/Users", undefined, "cira_scim_nope");
    expect(status).toBe(401);
    expect(body.schemas).toEqual(["urn:ietf:params:scim:api:messages:2.0:Error"]);
  });

  let danaScimId = "";
  it("makes someone Cira already knows a member the moment they are pushed", async () => {
    const created = await call("POST", "/Users", {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      userName: "Dana@acme.test",
      name: { givenName: "Dana", familyName: "Wu" },
      externalId: "00u-dana",
      active: true,
    });
    expect(created.status).toBe(201);
    danaScimId = created.body.id;
    expect(await memberOf(dana.id)).toMatchObject({ role: "member" });

    // Okta checks before pushing, by userName.
    const found = await call(
      "GET",
      "/Users?filter=userName%20eq%20%22dana%40acme.test%22",
    );
    expect(found.body.totalResults).toBe(1);
    expect(found.body.Resources[0].id).toBe(danaScimId);

    const again = await call("POST", "/Users", { userName: "dana@acme.test" });
    expect(again.status).toBe(409);
  });

  it("keeps a promise to someone with no account yet, at their first sign-in", async () => {
    const pushed = await call("POST", "/Users", {
      userName: "new@acme.test",
      active: true,
    });
    expect(pushed.status).toBe(201);

    const { users } = await import("@cira/db");
    const newcomer: User = {
      id: newId("user"),
      name: "New",
      email: "new@acme.test",
      createdAt: new Date(),
    };
    await database.insert(users).values({
      id: newcomer.id,
      externalId: "x_new",
      name: "New",
      email: newcomer.email,
    });
    expect(await memberOf(newcomer.id)).toBeNull();

    const { claimProvisioned } = await import("./scim");
    await claimProvisioned(newcomer);
    expect(await memberOf(newcomer.id)).toMatchObject({ role: "member" });
  });

  let groupId = "";
  it("keeps a pushed group as a team, with the people in it", async () => {
    const created = await call("POST", "/Groups", {
      displayName: "Finance",
      members: [{ value: danaScimId }],
    });
    expect(created.status).toBe(201);
    groupId = created.body.id;

    const { scimGroups, teamMembers, appAccess } = await import("@cira/db");
    const [group] = await database
      .select()
      .from(scimGroups)
      .where(eq(scimGroups.id, groupId));
    const seats = await database
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.teamId, group!.teamId));
    expect(seats.map((s) => s.userId)).toEqual([dana.id]);

    // The team is given an app, the way an admin would.
    await database.insert(appAccess).values({
      id: newId("access"),
      appId,
      type: "team",
      targetId: group!.teamId,
    });
  });

  it("takes someone out, and keeps them out, when Entra deactivates them", async () => {
    const { appAccess, spaceJoinBlocks, teamMembers } = await import("@cira/db");
    await database.insert(appAccess).values({
      id: newId("access"),
      appId,
      type: "user",
      targetId: dana.id,
    });

    const patched = await call("PATCH", `/Users/${danaScimId}`, {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "Replace", path: "active", value: "False" }],
    });
    expect(patched.status).toBe(200);
    expect(patched.body.active).toBe(false);

    expect(await memberOf(dana.id)).toBeNull();
    expect(
      await database.select().from(teamMembers).where(eq(teamMembers.userId, dana.id)),
    ).toEqual([]);
    expect(
      await database
        .select()
        .from(appAccess)
        .where(and(eq(appAccess.type, "user"), eq(appAccess.targetId, dana.id))),
    ).toEqual([]);
    const blocked = await database
      .select()
      .from(spaceJoinBlocks)
      .where(eq(spaceJoinBlocks.email, dana.email));
    expect(blocked).toHaveLength(1);

    // Back again when reactivated, in Okta's dialect.
    await call("PATCH", `/Users/${danaScimId}`, {
      Operations: [{ op: "replace", value: { active: true } }],
    });
    expect(await memberOf(dana.id)).not.toBeNull();
    expect(
      await database
        .select()
        .from(spaceJoinBlocks)
        .where(eq(spaceJoinBlocks.email, dana.email)),
    ).toEqual([]);
  });

  it("never takes out the last owner, whatever the directory says", async () => {
    const pushed = await call("POST", "/Users", { userName: owner.email });
    await call("PATCH", `/Users/${pushed.body.id}`, {
      Operations: [{ op: "replace", path: "active", value: false }],
    });
    expect(await memberOf(owner.id)).toMatchObject({ role: "owner" });
  });

  it("drops a group's team, and the apps it opened, when the group is deleted", async () => {
    const { scimGroups, teams, appAccess } = await import("@cira/db");
    const [group] = await database
      .select()
      .from(scimGroups)
      .where(eq(scimGroups.id, groupId));
    const deleted = await call("DELETE", `/Groups/${groupId}`);
    expect(deleted.status).toBe(204);
    expect(
      await database.select().from(teams).where(eq(teams.id, group!.teamId)),
    ).toEqual([]);
    expect(
      await database
        .select()
        .from(appAccess)
        .where(and(eq(appAccess.type, "team"), eq(appAccess.targetId, group!.teamId))),
    ).toEqual([]);
  });

  /**
   * A directory adds only people at a domain the company has shown it holds.
   * Before this, any admin of any space could push anyone's address and they
   * became a member with no invitation - reproduced on production.
   */
  describe("whose people a directory may add", () => {
    it("refuses someone at another domain, and keeps no row of them", async () => {
      const refused = await call("POST", "/Users", {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        userName: "victim@bigco.test",
        active: true,
      });
      expect(refused.status).toBe(400);
      expect(refused.body.scimType).toBe("invalidValue");
      expect(refused.body.detail).toContain("@acme.test");

      const listed = await call("GET", '/Users?filter=userName eq "victim@bigco.test"');
      expect(listed.body.totalResults).toBe(0);
    });

    it("refuses renaming someone to another domain", async () => {
      const created = await call("POST", "/Users", {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        userName: "rena@acme.test",
        active: true,
      });
      expect(created.status).toBe(201);

      const renamed = await call("PATCH", `/Users/${created.body.id}`, {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [{ op: "replace", path: "userName", value: "rena@bigco.test" }],
      });
      expect(renamed.status).toBe(400);
    });

    it("lets in someone at the domain single sign-on was set up for", async () => {
      const { spaceSso } = await import("@cira/db");
      await database.insert(spaceSso).values({
        spaceId,
        connectionId: "conn_test",
        domain: "acme-labs.test",
        createdByUserId: owner.id,
      });
      const created = await call("POST", "/Users", {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        userName: "lab@acme-labs.test",
        active: true,
      });
      expect(created.status).toBe(201);
      await database.delete(spaceSso).where(eq(spaceSso.spaceId, spaceId));
    });

    it("gives a space founded from a personal address no directory at all", async () => {
      const { spaces } = await import("@cira/db");
      const { directoryDomains } = await import("./scim");
      const personal = newId("space");
      await database
        .insert(spaces)
        .values({
          id: personal,
          name: "Personal",
          slug: "personal-co",
          domain: "gmail.com",
        });
      expect(await directoryDomains(personal)).toEqual([]);
    });

    it("does not let a row from before the rule make anyone a member", async () => {
      const { scimUsers, users } = await import("@cira/db");
      const { claimProvisioned } = await import("./scim");
      const outsider = { id: newId("user"), email: "someone@bigco.test" };
      await database.insert(users).values({
        id: outsider.id,
        externalId: "x_outsider",
        name: "Someone",
        email: outsider.email,
      });
      // Written straight into the table, as a row pushed before the check was.
      await database.insert(scimUsers).values({
        id: newId("scimUser"),
        spaceId,
        userName: outsider.email,
        active: true,
      });

      await claimProvisioned({
        id: outsider.id,
        name: "Someone",
        email: outsider.email,
        createdAt: new Date(),
      } as User);
      expect(await memberOf(outsider.id)).toBeNull();
    });
  });
});
