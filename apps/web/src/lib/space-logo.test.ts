import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { newId, type User } from "@cira/core";
import type * as CiraDb from "@cira/db";
import { migratedTestDatabase } from "../../../../packages/db/src/test-database.js";

/**
 * A company's logo: set and taken away by its admins only, never anything but
 * a small picture, written into the change record, and carried out with the
 * rest of the company when it leaves.
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
const admin = person("Ada");
const member = person("Milo");
const spaceId = newId("space");

/** A few hundred bytes of what the browser sends: a small webp as a data URL. */
const logo = `data:image/webp;base64,${"UklGR".padEnd(400, "A")}`;

async function stored(): Promise<string | null> {
  const { spaces } = await import("@cira/db");
  const [row] = await database
    .select({ image: spaces.image })
    .from(spaces)
    .where(eq(spaces.id, spaceId));
  return row?.image ?? null;
}

describe.skipIf(!hasDatabase)("a company's logo", () => {
  beforeAll(async () => {
    database = await migratedTestDatabase(TEST_DATABASE_URL as string, "cira_space_logo");
    const { memberships, spaces, users } = await import("@cira/db");
    await database.insert(users).values(
      [admin, member].map((u, i) => ({
        id: u.id,
        externalId: `logo${i}`,
        name: u.name,
        email: u.email,
      })),
    );
    await database.insert(spaces).values({ id: spaceId, name: "Acme", slug: "acme" });
    await database.insert(memberships).values([
      { id: newId("membership"), userId: admin.id, spaceId, role: "admin" },
      { id: newId("membership"), userId: member.id, spaceId, role: "member" },
    ]);
  }, 60_000);

  afterAll(async () => {
    await database?.end();
  });

  it("is set by an admin, and said so in the record", async () => {
    const { setSpaceLogo } = await import("./space-actions");
    const { spaceChanges } = await import("@cira/db");
    signedIn = admin;

    expect(await setSpaceLogo("acme", logo)).toEqual({ ok: true });
    expect(await stored()).toBe(logo);

    const changes = await database
      .select()
      .from(spaceChanges)
      .where(eq(spaceChanges.spaceId, spaceId));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: "space-logo-changed",
      actor: "Ada",
      subject: "Acme",
      detail: null,
    });
    // What changed, never with what: the picture itself stays out of the record.
    expect(JSON.stringify(changes)).not.toContain("base64");
  });

  it("cannot be changed by a member", async () => {
    const { setSpaceLogo } = await import("./space-actions");
    signedIn = member;

    const result = await setSpaceLogo("acme", "");
    expect(result.ok).toBe(false);
    expect(await stored()).toBe(logo);
  });

  it("refuses anything that is not a small picture", async () => {
    const { setSpaceLogo } = await import("./space-actions");
    signedIn = admin;

    for (const value of [
      "https://example.test/logo.png",
      "data:image/svg+xml;base64,PHN2Zz4=",
      `data:image/png;base64,${"A".repeat(200_000)}`,
    ]) {
      const result = await setSpaceLogo("acme", value);
      expect(result.ok, value.slice(0, 30)).toBe(false);
    }
    expect(await stored()).toBe(logo);
  });

  it("leaves with the company", async () => {
    const { exportSpace } = await import("./space-export");
    const exported = await exportSpace(spaceId);
    expect(exported?.space).toMatchObject({ name: "Acme", logo });
  });

  it("goes back to the letter when removed", async () => {
    const { setSpaceLogo } = await import("./space-actions");
    const { spaceChanges } = await import("@cira/db");
    signedIn = admin;

    expect(await setSpaceLogo("acme", "  ")).toEqual({ ok: true });
    expect(await stored()).toBeNull();

    const changes = await database
      .select()
      .from(spaceChanges)
      .where(eq(spaceChanges.spaceId, spaceId));
    expect(changes).toHaveLength(2);
    expect(changes.map((c) => [c.kind, c.detail])).toEqual(
      expect.arrayContaining([
        ["space-logo-changed", null],
        ["space-logo-changed", "removed"],
      ]),
    );
  });
});
