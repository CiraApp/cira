-- An app that was removed, kept just long enough to count what it ran. Every
-- company's apps share one Google bill, and Cira attributes it by the names
-- its own records give each app's services, workers and jobs. Removing an app
-- deleted those records, so an app that ran for three weeks of the month and
-- was removed yesterday vanished from the month's usage. Additive only.
CREATE TABLE IF NOT EXISTS "removed_apps" (
  "id" text PRIMARY KEY NOT NULL,
  "space_id" text NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "resources" jsonb NOT NULL,
  "removed_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "removed_apps_space_idx" ON "removed_apps" ("space_id", "removed_at");
