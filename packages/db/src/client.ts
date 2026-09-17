import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema.js";

export type Database = ReturnType<typeof createDatabase>;

/**
 * The host a local development database answers on.
 *
 * `localtest.me` and everything under it resolve to 127.0.0.1 from the public
 * DNS, so this needs no hosts-file entry and can never be anything but local.
 * That is what makes it safe to key behaviour off: production cannot
 * accidentally match it, and there is no environment variable to set wrongly.
 */
const LOCAL_HOST = "db.localtest.me";

export function createDatabase(connectionString: string) {
  // Neon's driver sends queries to Neon over HTTPS. Pointed at the local
  // proxy instead, the very same driver reaches a Postgres running on this
  // machine - so development exercises the real client, with the real
  // limitations, rather than a more capable stand-in that would hide them.
  //
  // Only ever reassigned for the local host. Production never takes this
  // branch, and so keeps the driver's own default endpoint untouched.
  if (hostOf(connectionString) === LOCAL_HOST) {
    neonConfig.fetchEndpoint = (host) => `http://${host}:4444/sql`;
  }

  return drizzle(neon(connectionString), { schema });
}

function hostOf(connectionString: string): string | null {
  try {
    return new URL(connectionString).hostname;
  } catch {
    return null;
  }
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
