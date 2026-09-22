-- Notices about a whole space - a trial ending, a payment failing, workers
-- switched off by a plan - rather than about one app, and a way for an email
-- that failed to go to be sent again.
--
-- `app_id` may now be empty, for a space's own notices. Those are claimed
-- once per space, kind and subject by an index of their own, since an index
-- over a null app_id would let the same notice be claimed twice.
--
-- `topic` is what the notice is about within its app - its web address, one
-- worker, one scheduled run - so a flapping app or a failing five-minute job
-- can be held to a few emails rather than hundreds.
--
-- `message` and `unsent` keep what was to be sent and to whom it has not gone
-- yet. A notice used to be claimed and then lost for good if the email
-- provider refused it; now the watcher tries again. Additive only.
ALTER TABLE "notifications" ALTER COLUMN "app_id" DROP NOT NULL;
ALTER TABLE "notifications" ADD COLUMN "topic" text;
ALTER TABLE "notifications" ADD COLUMN "message" jsonb;
ALTER TABLE "notifications" ADD COLUMN "unsent" text[] DEFAULT '{}' NOT NULL;
ALTER TABLE "notifications" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_space_event_idx" ON "notifications" ("space_id", "kind", "subject") WHERE "app_id" IS NULL;
CREATE INDEX IF NOT EXISTS "notifications_unsent_idx" ON "notifications" ("created_at") WHERE cardinality("unsent") > 0;
