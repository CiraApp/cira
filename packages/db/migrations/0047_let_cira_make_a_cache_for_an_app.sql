-- The Redis cache Cira made for an app on Upstash: which one, never its
-- password or address.
CREATE TABLE "app_caches" (
  "app_id" text PRIMARY KEY NOT NULL,
  "provider" text NOT NULL,
  "external_id" text NOT NULL,
  "env_name" text NOT NULL,
  "region" text NOT NULL,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_caches" ADD CONSTRAINT "app_caches_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_caches" ADD CONSTRAINT "app_caches_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
