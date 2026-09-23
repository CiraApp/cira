ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "deployed_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "source_label" text;
