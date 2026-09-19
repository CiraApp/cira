-- Workers and scheduled runs: what an app runs besides serving requests, found
-- in the repository at each deploy. And a flag on each deploy saying whether
-- it has a web process at all, so a script-only app is not mistaken for one
-- that failed to start. Additive only.
CREATE TYPE "public"."process_kind" AS ENUM('worker', 'scheduled');
--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "serves_web" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
CREATE TABLE "processes" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"space_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" "process_kind" NOT NULL,
	"command" text NOT NULL,
	"service_slug" text NOT NULL,
	"schedule" text,
	"schedule_set_at" timestamp with time zone,
	"timeout_minutes" integer,
	"enabled" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "processes" ADD CONSTRAINT "processes_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "processes" ADD CONSTRAINT "processes_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "processes_app_name_idx" ON "processes" USING btree ("app_id","name");
--> statement-breakpoint
CREATE INDEX "processes_space_idx" ON "processes" USING btree ("space_id");
