import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { newId, type User } from "@cira/core";
import type * as CiraDb from "@cira/db";
import { migratedTestDatabase } from "../../../../packages/db/src/test-database.js";

/**
 * Giving someone an app to manage, not only to open: who may, and the one
 * grant that may never carry it.
 */

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];
const hasDatabase = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== "";

let database: Awaited<ReturnType<typeof migratedTestDatabase>>;

vi.mock("@cira/db", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDb>();
  return { ...actual, db: () => database };
});

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
const owner = person("Owner");
const engineer = person("Engineer");
const bystander = person("Bystander");
const spaceId = newId("space");
const appId = newId("app");

describe.skipIf(!hasDatabase)("managing an app through a grant", () => {
  beforeAll(async () => {
    database = await migratedTestDatabase(TEST_DATABASE_URL as string, "cira_access");
    const { apps, memberships, spaces, users } = await import("@cira/db");
    await database.insert(users).values(
      [owner, engineer, bystander].map((u, i) => ({
        id: u.id,
        externalId: `a${i}`,
        name: u.name,
        email: u.email,
      })),
    );
    await database.insert(spaces).values({ id: spaceId, name: "Acme", slug: "acme" });
    await database.insert(memberships).values(
      [owner, engineer, bystander].map((u) => ({
        id: newId("membership"),
        userId: u.id,
        spaceId,
        role: "member" as const,
      })),
    );
    await database.insert(apps).values({
      id: appId,
      spaceId,
      name: "Payroll",
      slug: "payroll",
      ownerUserId: owner.id,
    });
  }, 60_000);

  afterAll(async () => {
    await database?.end();
  });

  const grants = async () => {
    const { appAccess } = await import("@cira/db");
    return database.select().from(appAccess).where(eq(appAccess.appId, appId));
  };

  it("lets the owner make a colleague a manager, who can then manage it", async () => {
    const { grantAccess, setAccessLevel } = await import("./access-actions");
    const { requireAppManage } = await import("./authz");

    signedIn = owner;
    expect(
      await grantAccess("acme", "payroll", { kind: "person", userId: engineer.id }),
    ).toEqual({ ok: true, data: null });
    const grant = (await grants()).find((g) => g.targetId === engineer.id);
    expect(grant?.level).toBe("use");

    // Opening it is not managing it.
    signedIn = engineer;
    await expect(requireAppManage("acme", "payroll")).rejects.toThrow();

    signedIn = owner;
    expect(await setAccessLevel("acme", "payroll", grant?.id ?? "", "manage")).toEqual({
      ok: true,
      data: null,
    });

    signedIn = engineer;
    await expect(requireAppManage("acme", "payroll")).resolves.toMatchObject({
      manages: true,
    });
  });

  it("never lets everyone at the company manage an app", async () => {
    const { grantAccess, setAccessLevel } = await import("./access-actions");
    signedIn = owner;
    await grantAccess("acme", "payroll", { kind: "everyone" });
    const everyone = (await grants()).find((g) => g.type === "space");

    const outcome = await setAccessLevel("acme", "payroll", everyone?.id ?? "", "manage");
    expect(outcome.ok).toBe(false);
    expect((await grants()).find((g) => g.type === "space")?.level).toBe("use");
  });

  it("does not let someone who only uses the app hand out managing it", async () => {
    const { setAccessLevel } = await import("./access-actions");
    const { appAccess } = await import("@cira/db");
    await database.insert(appAccess).values({
      id: newId("access"),
      appId,
      type: "user",
      targetId: bystander.id,
    });
    const mine = (await grants()).find((g) => g.targetId === bystander.id);

    signedIn = bystander;
    const outcome = await setAccessLevel("acme", "payroll", mine?.id ?? "", "manage");
    expect(outcome.ok).toBe(false);
    expect((await grants()).find((g) => g.targetId === bystander.id)?.level).toBe("use");
  });

  /**
   * An old address used to send anyone in the space to the app's new one,
   * which told a person who could not open it that it exists and what it is
   * called now.
   */
  it("writes down who gave access, and who took it away", async () => {
    const { grantAccess, revokeAccess } = await import("./access-actions");
    const { changesIn } = await import("./change-record");
    const { describeChange } = await import("@cira/core");

    signedIn = owner;
    await grantAccess("acme", "payroll", { kind: "person", userId: engineer.id });
    const grant = (await grants()).find((g) => g.targetId === engineer.id);
    await revokeAccess("acme", "payroll", grant?.id ?? "");

    const sentences = (await changesIn(spaceId)).map(describeChange);
    expect(sentences).toContain(`${owner.name} gave ${engineer.email} access to Payroll`);
    // Named by who lost it, although the grant itself is gone by then.
    expect(sentences).toContain(
      `${owner.name} took away ${engineer.email}'s access to Payroll`,
    );
  });

  it("follows a rename only for someone who may open the app", async () => {
    const { apps, appSlugHistory } = await import("@cira/db");
    const { movedAppFor } = await import("./authz");
    const ledger = newId("app");
    await database.insert(apps).values({
      id: ledger,
      spaceId,
      name: "Ledger",
      slug: "ledger",
      ownerUserId: owner.id,
    });
    await database
      .insert(appSlugHistory)
      .values({ id: newId("appSlug"), appId: ledger, spaceId, slug: "books" });

    signedIn = owner;
    expect(await movedAppFor("acme", "books")).toBe("ledger");
    signedIn = engineer;
    expect(await movedAppFor("acme", "books")).toBeNull();
    signedIn = person("Stranger");
    expect(await movedAppFor("acme", "books")).toBeNull();
  });
});
