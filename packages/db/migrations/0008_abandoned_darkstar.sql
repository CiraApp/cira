ALTER TYPE "public"."capability_method" ADD VALUE 'PUT';--> statement-breakpoint
ALTER TYPE "public"."capability_method" ADD VALUE 'PATCH';--> statement-breakpoint
ALTER TYPE "public"."capability_method" ADD VALUE 'DELETE';--> statement-breakpoint
ALTER TABLE "capabilities" ALTER COLUMN "confidence" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "capabilities" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "capabilities" ADD COLUMN "probe" jsonb;