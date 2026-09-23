ALTER TYPE "public"."capability_reach" ADD VALUE IF NOT EXISTS 'unconfirmed';--> statement-breakpoint
ALTER TABLE "capabilities" ADD COLUMN IF NOT EXISTS "unconfirmed_because" text;--> statement-breakpoint
ALTER TABLE "capabilities" ADD COLUMN IF NOT EXISTS "vouched_at" timestamp with time zone;
