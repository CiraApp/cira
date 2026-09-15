import { defineConfig } from "drizzle-kit";

// Load the repo-root .env.local for local runs. Absent in CI and on Vercel,
// where the variables are already in the environment.
try {
  process.loadEnvFile(new URL("../../.env.local", import.meta.url).pathname);
} catch {
  // No local env file; fall through to whatever is already set.
}

/**
 * Migrations run over the DIRECT connection, not the pooled one. Neon's pooler
 * runs PgBouncer in transaction mode, which is the wrong shape for DDL.
 */
const url = process.env["DATABASE_URL_UNPOOLED"] ?? process.env["DATABASE_URL"];

if (url === undefined || url === "") {
  throw new Error("Set DATABASE_URL_UNPOOLED (preferred) or DATABASE_URL.");
}

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
