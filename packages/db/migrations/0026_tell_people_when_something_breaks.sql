-- Notifications: one row per event people were emailed about, claimed before
-- the email is sent so each goes once. And what the watcher last saw of each
-- app's web address and workers, so an outage is told when it starts and when
-- it ends. Additive only.
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"space_id" text NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"recipients" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"failure" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_event_idx" ON "notifications" USING btree ("app_id","kind","subject");
--> statement-breakpoint
CREATE INDEX "notifications_space_idx" ON "notifications" USING btree ("space_id");
--> statement-breakpoint
CREATE TABLE "app_watch" (
	"app_id" text NOT NULL,
	"target" text NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"down_since" timestamp with time zone,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_watch" ADD CONSTRAINT "app_watch_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "app_watch_target_idx" ON "app_watch" USING btree ("app_id","target");
