import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { newId, type User } from "@cira/core";
import type * as CiraDb from "@cira/db";
import { migratedTestDatabase } from "../../../../packages/db/src/test-database.js";

/**
 * People leaving a company, the way a real one loses them: fired, moved on,
 * or leaving of their own accord. What must be true afterwards is that they
 * can reach nothing, that nothing they ran is left without an owner, and that
 * a verified address cannot walk them straight back in.
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

const person = (name: string): User => ({
  id: newId("user"),
  name,
  email: `${name.toLowerCase()}@acme.test`,
  createdAt: new Date(),
});
const founder = person("Founder");
const admin = person("Admin");
const leaver = person("Leaver");
const quitter = person("Quitter");
const spaceId = newId("space");
const payroll = newId("app");
const teamId = newId("team");

describe.skipIf(!hasDatabase)("people leaving a space", () => {
  beforeAll(async () => {
    database = await migratedTestDatabase(TEST_DATABASE_URL as string, "cira_members");
    const { appAccess, apps, memberships, spaces, teamMembers, teams, users } =
      await import("@cira/db");
    const everyone = [founder, admin, leaver, quitter];
    await database.insert(users).values(
      everyone.map((u, i) => ({
        id: u.id,
        externalId: `m${i}`,
        name: u.name,
        email: u.email,
      })),
    );
    await database.insert(spaces).values({
      id: spaceId,
      name: "Acme",
      slug: "acme",
      domain: "acme.test",
      joinByDomain: true,
    });
    await database.insert(memberships).values([
      { id: newId("membership"), userId: founder.id, spaceId, role: "owner" },
      { id: newId("membership"), userId: admin.id, spaceId, role: "admin" },
      { id: newId("membership"), userId: leaver.id, spaceId, role: "member" },
      { id: newId("membership"), userId: quitter.id, spaceId, role: "member" },
    ]);
    await database.insert(apps).values({
      id: payroll,
      spaceId,
      name: "Payroll",
      slug: "payroll",
      ownerUserId: leaver.id,
    });
    await database.insert(appAccess).values({
      id: newId("access"),
      appId: payroll,
      type: "user",
      targetId: leaver.id,
      level: "manage",
    });
    await database
      .insert(teams)
      .values({ id: teamId, spaceId, name: "Ops", slug: "ops" });
    await database
      .insert(teamMembers)
      .values({ id: newId("teamMember"), teamId, userId: leaver.id });
  }, 60_000);

  afterAll(async () => {
    await database?.end();
  });

  it("removes someone completely, and gives their apps to whoever removed them", async () => {
    const { removeMember } = await import("./member-actions");
    const { appAccess, apps, memberships, teamMembers } = await import("@cira/db");

    signedIn = admin;
    expect(await removeMember("acme", leaver.id)).toEqual({ ok: true });

    expect(
      await database
        .select()
        .from(memberships)
        .where(and(eq(memberships.userId, leaver.id), eq(memberships.spaceId, spaceId))),
    ).toEqual([]);
    const [app] = await database.select().from(apps).where(eq(apps.id, payroll));
    expect(app?.ownerUserId).toBe(admin.id);
    expect(
      await database.select().from(appAccess).where(eq(appAccess.targetId, leaver.id)),
    ).toEqual([]);
    expect(
      await database.select().from(teamMembers).where(eq(teamMembers.userId, leaver.id)),
    ).toEqual([]);
  });

  it("does not let a removed person back in with their address", async () => {
    const { joinableSpaces, joinSpaceByDomain } = await import("./join-actions");
    signedIn = leaver;
    expect(await joinableSpaces()).toEqual([]);
    const tried = await joinSpaceByDomain("acme");
    expect(tried.ok).toBe(false);
    expect(!tried.ok && tried.error).toContain("invite you back");
  });

  it("lets someone else at the domain join while it is switched on, and not once it is off", async () => {
    const { joinSpaceByDomain } = await import("./join-actions");
    const { spaces } = await import("@cira/db");
    const newcomer = person("Newcomer");
    const { users } = await import("@cira/db");
    await database.insert(users).values({
      id: newcomer.id,
      externalId: "m9",
      name: newcomer.name,
      email: newcomer.email,
    });

    await database
      .update(spaces)
      .set({ joinByDomain: false })
      .where(eq(spaces.id, spaceId));
    signedIn = newcomer;
    expect((await joinSpaceByDomain("acme")).ok).toBe(false);

    await database
      .update(spaces)
      .set({ joinByDomain: true })
      .where(eq(spaces.id, spaceId));
    expect((await joinSpaceByDomain("acme")).ok).toBe(true);
  });

  it("never lets the last owner go, and says what to do instead", async () => {
    const { leaveSpace, removeMember, changeRole } = await import("./member-actions");
    signedIn = founder;
    const left = await leaveSpace("acme");
    expect(left.ok).toBe(false);
    expect(!left.ok && left.error).toMatch(/Make someone else an owner/);

    expect((await changeRole("acme", founder.id, "admin")).ok).toBe(false);

    signedIn = admin;
    expect((await removeMember("acme", founder.id)).ok).toBe(false);
  });

  it("lets an owner hand over, then step down", async () => {
    const { changeRole } = await import("./member-actions");
    const { memberships } = await import("@cira/db");
    signedIn = founder;
    expect(await changeRole("acme", admin.id, "owner")).toEqual({ ok: true });
    expect(await changeRole("acme", founder.id, "admin")).toEqual({ ok: true });
    const [mine] = await database
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.userId, founder.id), eq(memberships.spaceId, spaceId)));
    expect(mine?.role).toBe("admin");
  });

  it("keeps the owner role out of an admin's hands", async () => {
    const { changeRole } = await import("./member-actions");
    signedIn = founder; // an admin now
    expect((await changeRole("acme", quitter.id, "owner")).ok).toBe(false);
  });

  /**
   * The record is written by the actions themselves, so what it says can be
   * trusted to be what happened rather than what the page displayed.
   */
  it("writes down every change to who is here, and who made it", async () => {
    const { changesIn } = await import("./change-record");
    const { describeChange } = await import("@cira/core");

    const sentences = (await changesIn(spaceId)).map(describeChange);

    // Every one of these happened in the tests above, through the real actions.
    expect(sentences).toContain(`Admin removed ${leaver.email}`);
    expect(sentences).toContain(`Founder changed ${admin.email} from admin to owner`);
    expect(sentences).toContain(`Founder changed ${founder.email} from owner to admin`);
    expect(
      sentences.some((line) => line.includes("joined as member, with an @acme.test")),
    ).toBe(true);

    // A refused change writes nothing: only what happened is in the record.
    expect(sentences.some((line) => line.includes("to owner"))).toBe(true);
    expect(sentences.filter((line) => line.includes(`${quitter.email} left`))).toEqual(
      [],
    );
  });

  it("keeps one company's record out of another's", async () => {
    const { changesIn } = await import("./change-record");
    const { spaces } = await import("@cira/db");
    const other = newId("space");
    await database.insert(spaces).values({ id: other, name: "Other", slug: "other-co" });

    expect(await changesIn(other)).toEqual([]);
    expect((await changesIn(spaceId)).length).toBeGreaterThan(0);
  });

  it("lets a member leave, and gives what they owned to an owner", async () => {
    const { leaveSpace } = await import("./member-actions");
    const { apps, memberships } = await import("@cira/db");
    const mine = newId("app");
    await database
      .insert(apps)
      .values({ id: mine, spaceId, name: "Mine", slug: "mine", ownerUserId: quitter.id });

    signedIn = quitter;
    expect(await leaveSpace("acme")).toEqual({ ok: true });
    const [app] = await database.select().from(apps).where(eq(apps.id, mine));
    expect(app?.ownerUserId).toBe(admin.id); // the one owner left
    expect(
      await database.select().from(memberships).where(eq(memberships.userId, quitter.id)),
    ).toEqual([]);
  });
});
