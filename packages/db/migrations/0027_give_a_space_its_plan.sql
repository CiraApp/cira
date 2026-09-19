-- Which plan a space is on. Everything that exists today has been on a trial
-- by any reading, so that is the default. What each plan allows and costs is
-- in core's plans.ts. Additive only.
ALTER TABLE "spaces" ADD COLUMN "plan" text DEFAULT 'trial' NOT NULL;
