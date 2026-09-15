import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

/**
 * A database handle for tests, over an ordinary Postgres connection.
 *
 * The application speaks to Neon over HTTP, which cannot reach a local
 * Postgres. Tests therefore bring their own driver rather than the app
 * bending to accommodate them, and the schema under test is the real one.
 */
export type TestDatabase = ReturnType<typeof drizzle<typeof schema>> & {
  end: () => Promise<void>;
};

export function createTestDatabase(
  connectionString: string,
  /**
   * Postgres schema to work in. Each test file gets its own, so suites can run
   * in parallel against one database without racing each other.
   *
   * Set on the pool rather than per query, because a pool hands out several
   * connections and a `set search_path` on one of them would leave the others
   * pointing at `public`.
   */
  searchPath = "public",
): TestDatabase {
  const pool = new pg.Pool({
    connectionString,
    max: 4,
    options: `-c search_path=${searchPath}`,
  });
  const db = drizzle(pool, { schema }) as TestDatabase;
  db.end = () => pool.end();
  return db;
}
