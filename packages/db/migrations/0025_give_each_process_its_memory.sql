-- How much memory each worker and scheduled run is given: what its repository
-- asked for, or what a person chose, with when they chose it so a redeploy
-- keeps their choice. Null memory means the default. Additive only.
ALTER TABLE "processes" ADD COLUMN "memory_mib" integer;
--> statement-breakpoint
ALTER TABLE "processes" ADD COLUMN "memory_set_at" timestamp with time zone;
