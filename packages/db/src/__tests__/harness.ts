import { randomUUID } from "node:crypto";
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

  // A schema of its own per caller. Vitest runs test files in parallel, and
  // when two of them shared `public` each one's reset tore down the other's
  // tables mid-run - a failure that only appeared once there was a second
  // suite, and that would have looked like a flake rather than a collision.
  const namespace = `cira_test_${randomUUID().replaceAll("-", "").slice(0, 16)}`;

  const admin = createTestDatabase(TEST_DATABASE_URL as string);
  try {
    await admin.execute(sql.raw(`drop schema if exists ${namespace} cascade`));
    await admin.execute(sql.raw(`create schema ${namespace}`));
  } finally {
    await admin.end();
  }

  const db = createTestDatabase(TEST_DATABASE_URL as string, namespace);

  const dir = join(import.meta.dirname, "..", "..", "migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    // Drizzle writes `"public"."role"` into every enum and reference. Pointing
    // those at this run's own schema is what actually isolates one suite from
    // another; the search_path alone would leave the types shared.
    const body = readFileSync(join(dir, file), "utf8").replaceAll(
      '"public".',
      `"${namespace}".`,
    );
    for (const statement of body.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed !== "") await db.execute(sql.raw(trimmed));
    }
  }

  return db;
}
