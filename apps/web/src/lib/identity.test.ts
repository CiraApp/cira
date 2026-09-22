import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { newId } from "@cira/core";
import type * as CiraDb from "@cira/db";
import { migratedTestDatabase } from "../../../../packages/db/src/test-database.js";

/**
 * Turning a sign-in into a Cira user, across a change of sign-in instance.
 *
 * Clerk's ids belong to one instance. Moving from its development instance to
 * a production one gives everyone a new id, and each of them must still land
 * as the Cira user they were - same id, same spaces - rather than as a
 * stranger, or as a sign-in the unique email index refuses outright.
 */

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];
const hasDatabase = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== "";

let database: Awaited<ReturnType<typeof migratedTestDatabase>>;

vi.mock("@cira/db", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDb>();
  return { ...actual, db: () => database };
});

/** Who Clerk says is signed in, and on which instance's ids. */
let session: {
  userId: string;
  email: string;
  verified: boolean;
  firstName?: string;
} | null = null;

/** The ids the sign-in instance Cira is pointed at knows. Anything else is 404. */
const instance = new Set<string>();

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: () =>
    Promise.resolve({
      users: {
        getUser: (id: string) =>
          instance.has(id)
            ? Promise.resolve({ id })
            : Promise.reject(Object.assign(new Error("not found"), { status: 404 })),
      },
    }),
  auth: () => Promise.resolve({ userId: session?.userId ?? null }),
  currentUser: () =>
    Promise.resolve(
      session === null
        ? null
        : {
            id: session.userId,
            firstName: session.firstName ?? null,
            lastName: null,
            username: null,
            imageUrl: "",
            primaryEmailAddress: { id: "e1", emailAddress: session.email },
            emailAddresses: [
              {
                id: "e1",
                emailAddress: session.email,
                verification: { status: session.verified ? "verified" : "unverified" },
              },
            ],
          },
    ),
}));

describe.skipIf(!hasDatabase)("getCurrentUser", () => {
  beforeAll(async () => {
    database = await migratedTestDatabase(TEST_DATABASE_URL as string, "cira_identity");
  }, 60_000);

  afterAll(async () => {
    session = null;
    await database?.end();
  });

  it("keeps a person as the same Cira user when their sign-in id changes", async () => {
    const { getCurrentUser } = await import("./identity");
    const { memberships, spaces, users } = await import("@cira/db");

    // Signed in on the development instance, and a member of a space.
    session = {
      userId: "user_dev_1",
      email: "Aum@Paradym.test",
      verified: true,
      firstName: "Aum",
    };
    const before = await getCurrentUser();
    expect(before).not.toBeNull();
    // From before production sign-in went live, which is the move this is for.
    await database
      .update(users)
      .set({ createdAt: new Date("2026-09-10T00:00:00Z") })
      .where(eq(users.id, before!.id));
    const spaceId = newId("space");
    await database
      .insert(spaces)
      .values({ id: spaceId, name: "Paradym", slug: "paradym", domain: "paradym.test" });
    await database
      .insert(memberships)
      .values({ id: newId("membership"), userId: before!.id, spaceId, role: "owner" });

    // Production instance: a new id for the same verified address. The
    // development id means nothing to it.
    instance.add("user_live_9");
    session = {
      userId: "user_live_9",
      email: "aum@paradym.test",
      verified: true,
      firstName: "Aum",
    };
    const after = await getCurrentUser();

    expect(after?.id).toBe(before!.id);
    const rows = await database.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.externalId).toBe("user_live_9");
    const kept = await database
      .select()
      .from(memberships)
      .where(eq(memberships.userId, before!.id));
    expect(kept).toHaveLength(1);

    // And back again, should Cira ever be pointed at the old instance.
    instance.clear();
    instance.add("user_dev_1");
    session = { userId: "user_dev_1", email: "aum@paradym.test", verified: true };
    expect((await getCurrentUser())?.id).toBe(before!.id);
    instance.clear();
  });

  it("does not hand a leaver's account to whoever is given their address next", async () => {
    const { getCurrentUser } = await import("./identity");
    const { memberships, spaces, users } = await import("@cira/db");

    // Alice, at Acme, signed up after production sign-in went live.
    instance.add("user_alice");
    session = { userId: "user_alice", email: "alice@acme.test", verified: true };
    const alice = await getCurrentUser();
    const acme = newId("space");
    await database.insert(spaces).values({ id: acme, name: "Acme", slug: "acme" });
    await database.insert(memberships).values({
      id: newId("membership"),
      userId: alice!.id,
      spaceId: acme,
      role: "admin",
    });

    // Her account is deleted; IT gives the mailbox to a new hire.
    instance.delete("user_alice");
    instance.add("user_newhire");
    session = { userId: "user_newhire", email: "alice@acme.test", verified: true };
    await expect(getCurrentUser()).rejects.toThrow("REDIRECT /account-conflict");

    const [row] = await database.select().from(users).where(eq(users.id, alice!.id));
    expect(row?.externalId).toBe("user_alice");
  });

  it("does not take an address from an account that still exists", async () => {
    const { getCurrentUser } = await import("./identity");
    instance.add("user_bob");
    session = { userId: "user_bob", email: "bob@acme.test", verified: true };
    await getCurrentUser();

    instance.add("user_bob_again");
    session = { userId: "user_bob_again", email: "bob@acme.test", verified: true };
    await expect(getCurrentUser()).rejects.toThrow("REDIRECT /account-conflict");
  });

  it("gives back an account that belongs to nowhere, and cuts off its old tokens", async () => {
    const { getCurrentUser } = await import("./identity");
    const { cliTokens } = await import("@cira/db");
    instance.add("user_carol");
    session = { userId: "user_carol", email: "carol@acme.test", verified: true };
    const carol = await getCurrentUser();
    await database.insert(cliTokens).values({
      id: newId("cliToken"),
      userId: carol!.id,
      tokenHash: "hash_carol",
      label: "old laptop",
    });

    // Deleted her sign-in and signed up again; she was in no company.
    instance.delete("user_carol");
    instance.add("user_carol_2");
    session = { userId: "user_carol_2", email: "carol@acme.test", verified: true };
    expect((await getCurrentUser())?.id).toBe(carol!.id);

    const [token] = await database
      .select()
      .from(cliTokens)
      .where(eq(cliTokens.userId, carol!.id));
    expect(token?.revokedAt).not.toBeNull();
  });

  it("never re-links, or admits, an address that is not verified", async () => {
    const { getCurrentUser } = await import("./identity");
    const { users } = await import("@cira/db");

    session = { userId: "user_live_evil", email: "aum@paradym.test", verified: false };
    expect(await getCurrentUser()).toBeNull();

    const [row] = await database
      .select()
      .from(users)
      .where(eq(users.email, "aum@paradym.test"));
    expect(row?.externalId).toBe("user_dev_1");
  });

  it("still creates a new person the first time an address is seen", async () => {
    const { getCurrentUser } = await import("./identity");

    session = { userId: "user_live_2", email: "new@paradym.test", verified: true };
    const created = await getCurrentUser();
    expect(created?.email).toBe("new@paradym.test");

    session = { userId: "user_live_2", email: "new@paradym.test", verified: true };
    expect((await getCurrentUser())?.id).toBe(created?.id);
  });
});
