CREATE TABLE "app_opens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"app_id" text NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_opens" ADD CONSTRAINT "app_opens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_opens" ADD CONSTRAINT "app_opens_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_opens_user_app_idx" ON "app_opens" USING btree ("user_id","app_id");--> statement-breakpoint
CREATE INDEX "app_opens_user_idx" ON "app_opens" USING btree ("user_id");