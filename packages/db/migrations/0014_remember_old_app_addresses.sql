CREATE TABLE "app_slug_history" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"space_id" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_slug_history" ADD CONSTRAINT "app_slug_history_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_slug_history" ADD CONSTRAINT "app_slug_history_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_slug_history_space_slug_idx" ON "app_slug_history" USING btree ("space_id","slug");--> statement-breakpoint
CREATE INDEX "app_slug_history_app_idx" ON "app_slug_history" USING btree ("app_id");