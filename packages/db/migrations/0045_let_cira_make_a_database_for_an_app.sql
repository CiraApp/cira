-- The Postgres database Cira made for an app: which Neon project, and the
-- names of its database and role. Never its password or address.
CREATE TABLE "app_databases" (
  "app_id" text PRIMARY KEY NOT NULL,
  "provider" text NOT NULL,
  "external_id" text NOT NULL,
  "database_name" text NOT NULL,
  "role_name" text NOT NULL,
  "env_name" text NOT NULL,
  "region" text NOT NULL,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_databases" ADD CONSTRAINT "app_databases_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_databases" ADD CONSTRAINT "app_databases_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
