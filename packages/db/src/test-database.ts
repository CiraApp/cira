import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { sql } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "./testing.js";

/*
 * Kept out of the package's index on purpose. It reads the migrations off the
 * disk next to this file, and a bundler following the index from the web app
 * would try to resolve that directory as part of the build. Tests import it by
 * path; nothing that ships ever does.
 */
/**
 * A fresh Postgres schema with every migration applied, for one test file.
 *
 * The migrations are the real ones, run in order, so a suite exercises the
 * schema production has rather than one pushed from the TypeScript. Each call
 * gets a schema of its own under a random name, which is what lets suites run
 * in parallel against one database.
 */
export async function migratedTestDatabase(
  connectionString: string,
  /** Starts the schema's name, so a leftover one says which suite made it. */
  prefix: string,
): Promise<TestDatabase> {
  const namespace = `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

  const admin = createTestDatabase(connectionString);
  await admin.execute(sql.raw(`drop schema if exists ${namespace} cascade`));
  await admin.execute(sql.raw(`create schema ${namespace}`));
  await admin.end();

  const db = createTestDatabase(connectionString, namespace);
  const dir = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const body = readFileSync(new URL(file, dir), "utf8").replaceAll(
      '"public".',
      `"${namespace}".`,
    );
    for (const statement of body.split("--> statement-breakpoint")) {
      if (statement.trim() !== "") await db.execute(sql.raw(statement));
    }
  }
  return db;
}
