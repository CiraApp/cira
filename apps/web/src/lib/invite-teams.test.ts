import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { newId, type User } from "@cira/core";
import type * as CiraDb from "@cira/db";
import { migratedTestDatabase } from "../../../../packages/db/src/test-database.js";

/**
 * Inviting someone onto a team, so they arrive with their access rather than
 * being chased onto a roster on their first day - which is how a team quietly
 * stops meaning what it says.
 */

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];
const hasDatabase = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== "";

let database: Awaited<ReturnType<typeof migratedTestDatabase>>;

vi.mock("@cira/db", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDb>();
  return { ...actual, db: () => database };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

let signedIn: User | null = null;
vi.mock("@/lib/identity", () => ({
  getCurrentUser: () => Promise.resolve(signedIn),
  requireCurrentUser: () => Promise.resolve(signedIn),
}));

const admin: User = {
  id: newId("user"),
  name: "Ada",
  email: "ada@teams.test",
  createdAt: new Date(),
};
const hire: User = {
  id: newId("user"),
  name: "Ned",
  email: "ned@teams.test",
  createdAt: new Date(),
};
const spaceId = newId("space");
const otherSpaceId = newId("space");
const support = newId("team");
const engineering = newId("team");
const elsewhere = newId("team");

const invite = async (form: Record<string, string | string[]>) => {
  const { createInvite } = await import("./invite-actions");
  const data = new FormData();
  for (const [key, value] of Object.entries(form)) {
    for (const one of Array.isArray(value) ? value : [value]) data.append(key, one);
  }
  return createInvite(null, data);
};

describe.skipIf(!hasDatabase)("inviting someone onto a team", () => {
  beforeAll(async () => {
    database = await migratedTestDatabase(TEST_DATABASE_URL as string, "cira_invteams");
    const { memberships, spaces, teams, users } = await import("@cira/db");

    await database.insert(users).values([
      { id: admin.id, externalId: "t1", name: admin.name, email: admin.email },
      { id: hire.id, externalId: "t2", name: hire.name, email: hire.email },
    ]);
    await database.insert(spaces).values([
      { id: spaceId, name: "Teams", slug: "teams-co", domain: "teams.test" },
      { id: otherSpaceId, name: "Other", slug: "other-co" },
    ]);
    await database
      .insert(memberships)
      .values({ id: newId("membership"), userId: admin.id, spaceId, role: "admin" });
    await database.insert(teams).values([
      { id: support, spaceId, name: "Support", slug: "support" },
      { id: engineering, spaceId, name: "Engineering", slug: "engineering" },
      { id: elsewhere, spaceId: otherSpaceId, name: "Elsewhere", slug: "elsewhere" },
    ]);
  }, 60_000);

  afterAll(async () => {
    signedIn = null;
    await database?.end();
  });

  beforeEach(async () => {
    const { invites, memberships, teamMembers } = await import("@cira/db");
    await database.delete(invites).where(eq(invites.spaceId, spaceId));
    await database.delete(teamMembers).where(eq(teamMembers.userId, hire.id));
    await database.delete(memberships).where(eq(memberships.userId, hire.id));
    signedIn = admin;
  });

  const onTeams = async () => {
    const { teamMembers, teams } = await import("@cira/db");
    const rows = await database
      .select({ name: teams.name })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(eq(teamMembers.userId, hire.id));
    return rows.map((r) => r.name).sort();
  };

  it("puts them on their teams the moment they accept", async () => {
    const { acceptInvite } = await import("./invite-actions");

    const created = await invite({
      spaceSlug: "teams-co",
      email: hire.email,
      role: "member",
      teams: [support, engineering],
    });
    if (!created.ok) throw new Error(created.error);

    // Nothing yet: they have not accepted, and may never.
    expect(await onTeams()).toEqual([]);

    signedIn = hire;
    expect(await acceptInvite(created.data.url.replace("/invite/", ""))).toMatchObject({
      ok: true,
    });
    expect(await onTeams()).toEqual(["Engineering", "Support"]);
  });

  it("drops a team belonging to another company", async () => {
    const { acceptInvite } = await import("./invite-actions");
    const { inviteTeams } = await import("@cira/db");

    const created = await invite({
      spaceSlug: "teams-co",
      email: hire.email,
      role: "member",
      teams: [support, elsewhere],
    });
    if (!created.ok) throw new Error(created.error);

    // The invitation stands; the team that is not this company's does not.
    expect(await database.select().from(inviteTeams)).toHaveLength(1);

    signedIn = hire;
    await acceptInvite(created.data.url.replace("/invite/", ""));
    expect(await onTeams()).toEqual(["Support"]);
  });

  it("still lets them in when the team was deleted while they waited", async () => {
    const { acceptInvite } = await import("./invite-actions");
    const { teams } = await import("@cira/db");

    const gone = newId("team");
    await database
      .insert(teams)
      .values({ id: gone, spaceId, name: "Seasonal", slug: "seasonal" });

    const created = await invite({
      spaceSlug: "teams-co",
      email: hire.email,
      role: "member",
      teams: [support, gone],
    });
    if (!created.ok) throw new Error(created.error);

    await database.delete(teams).where(eq(teams.id, gone));

    signedIn = hire;
    expect(await acceptInvite(created.data.url.replace("/invite/", ""))).toMatchObject({
      ok: true,
    });
    expect(await onTeams()).toEqual(["Support"]);
  });

  it("says in the record which teams someone was invited onto and joined", async () => {
    const { acceptInvite } = await import("./invite-actions");
    const { changesIn } = await import("./change-record");
    const { describeChange } = await import("@cira/core");

    const created = await invite({
      spaceSlug: "teams-co",
      email: hire.email,
      role: "member",
      teams: [support],
    });
    if (!created.ok) throw new Error(created.error);

    signedIn = hire;
    await acceptInvite(created.data.url.replace("/invite/", ""));

    const sentences = (await changesIn(spaceId)).map(describeChange);
    expect(sentences).toContain(`Ada invited ${hire.email} as member, on Support`);
    expect(sentences).toContain(
      `${hire.email} joined as member, by invitation, on Support`,
    );
  });
});
