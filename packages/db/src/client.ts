import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema.js";

export type Database = ReturnType<typeof createDatabase>;

export function createDatabase(connectionString: string) {
  return drizzle(neon(connectionString), { schema });
}

let cached: Database | undefined;

/**
 * The request-scoped handle. Neon's HTTP driver holds no socket, so caching
 * this across serverless invocations is safe and saves the setup on warm hits.
 */
export function db(): Database {
  if (cached !== undefined) return cached;

  const url = process.env["DATABASE_URL"];
  if (url === undefined || url === "") {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
    );
  }

  cached = createDatabase(url);
  return cached;
}
