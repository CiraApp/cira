import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { atomically } from "../atomic.js";
import { apps, spaces, users } from "../schema.js";
import type { TestDatabase } from "../testing.js";
import { freshDatabase, hasDatabase } from "./harness.js";

/**
 * All of the writes, or none of them.
 *
 * Worth testing against a real database rather than a stub, because the whole
 * value of this is a guarantee the database makes. A stub that recorded the
 * calls would confirm the code's intentions and nothing about whether Postgres
 * actually rewound anything.
 *
 * The failing statement here is a foreign key violation, which is a refusal
 * the database makes on its own. Nothing in Cira decides it, so nothing in
 * Cira can accidentally be what makes this pass.
 */
describe.skipIf(!hasDatabase)("atomically", () => {
  let db: TestDatabase;

  const space = "spc_atomic";
  const owner = "usr_atomic";

  beforeAll(async () => {
    db = await freshDatabase();
    await db
      .insert(users)
      .values({ id: owner, externalId: "ext_atomic", name: "T", email: "t@atomic.test" });
    await db.insert(spaces).values({ id: space, name: "Atomic", slug: "atomic" });
  });

  afterAll(async () => {
    await db?.end();
  });

  const anApp = (id: string, slug: string) => ({
    id,
    spaceId: space,
    name: slug,
    slug,
    ownerUserId: owner,
  });

  const slugs = async () =>
    (await db.select({ slug: apps.slug }).from(apps).where(eq(apps.spaceId, space)))
      .map((row) => row.slug)
      .sort();

  it("applies every write when they all succeed", async () => {
    await atomically(db, (on) => [
      on.insert(apps).values(anApp("app_ok_1", "first")),
      on.insert(apps).values(anApp("app_ok_2", "second")),
    ]);

    expect(await slugs()).toEqual(["first", "second"]);
  });

  it("rewinds a write that already succeeded when a later one fails", async () => {
    // The destructive shape that motivated this: remove the old, write the
    // new, and fail in between. Without a transaction the delete stands.
    await expect(
      atomically(db, (on) => [
        on.delete(apps).where(eq(apps.id, "app_ok_1")),
        on.insert(apps).values({ ...anApp("app_bad", "bad"), ownerUserId: "nobody" }),
      ]),
    ).rejects.toThrow();

    expect(await slugs()).toEqual(["first", "second"]);
  });

  it("writes nothing at all when the first statement is the one that fails", async () => {
    await expect(
      atomically(db, (on) => [
        on.insert(apps).values({ ...anApp("app_bad2", "bad2"), ownerUserId: "nobody" }),
        on.insert(apps).values(anApp("app_third", "third")),
      ]),
    ).rejects.toThrow();

    expect(await slugs()).toEqual(["first", "second"]);
  });

  it("does nothing, rather than failing, when there is nothing to do", async () => {
    // Callers build their list from a plan that is routinely empty - a
    // redeploy that changed nothing - and should not have to check first.
    await expect(atomically(db, () => [])).resolves.toBeUndefined();
    expect(await slugs()).toEqual(["first", "second"]);
  });
});
