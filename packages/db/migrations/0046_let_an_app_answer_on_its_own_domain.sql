-- A company's own hostname for an app, served through a Cloudflare custom
-- hostname. One app per name.
CREATE TABLE "app_domains" (
  "hostname" text PRIMARY KEY NOT NULL,
  "app_id" text NOT NULL,
  "external_id" text NOT NULL,
  "state" text NOT NULL,
  "reason" text,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_domains" ADD CONSTRAINT "app_domains_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_domains" ADD CONSTRAINT "app_domains_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "app_domains_app_idx" ON "app_domains" USING btree ("app_id");
