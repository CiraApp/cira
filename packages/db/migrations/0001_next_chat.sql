ALTER TABLE "spaces" ADD COLUMN "domain" text;--> statement-breakpoint
CREATE INDEX "spaces_domain_idx" ON "spaces" USING btree ("domain");