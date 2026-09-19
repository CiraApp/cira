import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { newId, type User } from "@cira/core";
import type * as CiraDb from "@cira/db";
import { migratedTestDatabase } from "../../../../packages/db/src/test-database.js";

/**
 * The secrets Cira hands out, end to end: an invite link and a `cira login`.
 *
 * Each is given to a person or a CLI once and afterwards only has to be
 * recognised, so the database keeps a hash of it and never the value. These
 * run the real flows - create, then use - and then read every stored row as
 * text to make sure the value appears nowhere: a copy of the database must
 * not be a way into a space or onto someone's account.
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

const admin: User = {
  id: newId("user"),
  name: "Ada",
  email: "ada@secrets.test",
  createdAt: new Date(),
};
const newcomer: User = {
  id: newId("user"),
  name: "Ned",
  email: "ned@secrets.test",
  createdAt: new Date(),
};
const spaceId = newId("space");

/** Every row of a table, as the text a database dump would contain. */
async function dump(table: string): Promise<string> {
  const result = await database.execute(sql.raw(`select t::text as row from ${table} t`));
  return result.rows.map((r) => String((r as { row: unknown }).row)).join("\n");
}

describe.skipIf(!hasDatabase)("secrets Cira hands out", () => {
  beforeAll(async () => {
    database = await migratedTestDatabase(TEST_DATABASE_URL as string, "cira_secrets");
    const { memberships, spaces, users } = await import("@cira/db");

    await database.insert(users).values([
      { id: admin.id, externalId: "s1", name: admin.name, email: admin.email },
      { id: newcomer.id, externalId: "s2", name: newcomer.name, email: newcomer.email },
    ]);
    await database
      .insert(spaces)
      .values({ id: spaceId, name: "Secrets", slug: "secrets", domain: "secrets.test" });
    await database
      .insert(memberships)
      .values({ id: newId("membership"), userId: admin.id, spaceId, role: "admin" });
  }, 60_000);

  afterAll(async () => {
    signedIn = null;
    await database?.end();
  });

  it("keeps an invite link only as a hash, and the link still works", async () => {
    const { acceptInvite, createInvite } = await import("./invite-actions");

    signedIn = admin;
    const form = new FormData();
    form.set("spaceSlug", "secrets");
    form.set("email", newcomer.email);
    form.set("role", "member");
    const created = await createInvite(null, form);
    if (!created.ok) throw new Error(created.error);

    const token = created.data.url.replace("/invite/", "");
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await dump("invites")).not.toContain(token);

    // The person it was for can still use it, once.
    signedIn = newcomer;
    expect(await acceptInvite(token)).toMatchObject({ ok: true, spaceSlug: "secrets" });
    expect(await acceptInvite(token)).toMatchObject({ ok: false });
  });

  it("keeps a login's device code only as a hash, and the login still completes", async () => {
    const { POST: start } = await import("../app/api/cli/auth/start/route");
    const { POST: poll } = await import("../app/api/cli/auth/poll/route");
    const { approveCliLogin } = await import("./cli-approve-actions");

    const started = (await (
      await start(new Request("http://cira.test", { method: "POST", body: "{}" }))
    ).json()) as { deviceCode: string; userCode: string };

    expect(await dump("cli_auth_requests")).not.toContain(started.deviceCode);

    const ask = () =>
      poll(
        new Request("http://cira.test", {
          method: "POST",
          body: JSON.stringify({ deviceCode: started.deviceCode }),
        }),
      ).then((r) => r.json() as Promise<{ status: string; token?: string }>);

    expect((await ask()).status).toBe("pending");

    signedIn = admin;
    expect(await approveCliLogin(started.userCode)).toMatchObject({ ok: true });

    const approved = await ask();
    expect(approved.status).toBe("approved");
    expect(approved.token).toMatch(/^cira_/);

    // The token it was exchanged for is not stored either.
    expect(await dump("cli_tokens")).not.toContain(approved.token);
    expect(await dump("cli_auth_requests")).not.toContain(started.deviceCode);
  });

  it("stores no app secret at all", async () => {
    const columns = await database.execute(
      sql.raw(
        `select column_name from information_schema.columns
         where table_schema = current_schema() and table_name = 'apps'
           and column_name = 'access_secret'`,
      ),
    );
    // Present until the column is dropped, and empty either way.
    if (columns.rows.length > 0) {
      const held = await database.execute(
        sql.raw(`select count(*)::int as n from apps where access_secret is not null`),
      );
      expect((held.rows[0] as { n: number }).n).toBe(0);
    }
  });
});
