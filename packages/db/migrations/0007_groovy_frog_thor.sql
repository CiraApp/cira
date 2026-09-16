CREATE TABLE "app_env_vars" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"set_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_env_vars" ADD CONSTRAINT "app_env_vars_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_env_vars" ADD CONSTRAINT "app_env_vars_set_by_user_id_users_id_fk" FOREIGN KEY ("set_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_env_vars_app_key_idx" ON "app_env_vars" USING btree ("app_id","key");--> statement-breakpoint
CREATE INDEX "app_env_vars_app_idx" ON "app_env_vars" USING btree ("app_id");