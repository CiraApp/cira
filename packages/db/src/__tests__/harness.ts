import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "../testing.js";

/**
 * Integration tests run against a real Postgres with the real migrations.
 *
 * A fake would pass while the actual schema rejected the same writes, which is
 * the whole point of testing this layer: the constraints ARE the safety, so
 * they have to be the ones under test.
 *
 * Skipped rather than failed when no database is offered, so `pnpm test` still
 * works on a laptop with nothing running.
 */
export const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];
export const hasDatabase = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== "";

export async function freshDatabase(): Promise<TestDatabase> {
  if (!hasDatabase) throw new Error("No TEST_DATABASE_URL");

  const db = createTestDatabase(TEST_DATABASE_URL as string);

  // Start from nothing every run, so one test's leftovers can never be
  // another's passing condition.
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`create schema public`);

  const dir = join(import.meta.dirname, "..", "..", "migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const body = readFileSync(join(dir, file), "utf8");
    for (const statement of body.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed !== "") await db.execute(sql.raw(trimmed));
    }
  }

  return db;
}
