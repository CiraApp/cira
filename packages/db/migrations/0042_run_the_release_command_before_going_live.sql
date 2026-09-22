-- A deploy's release command (the migration): who claimed its start, the
-- run it started, and when it succeeded. The claim is what keeps it to once.
ALTER TABLE "deployments" ADD COLUMN "release_started_at" timestamp with time zone;
ALTER TABLE "deployments" ADD COLUMN "release_run" text;
ALTER TABLE "deployments" ADD COLUMN "release_done_at" timestamp with time zone;
