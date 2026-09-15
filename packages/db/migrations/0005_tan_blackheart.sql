CREATE TYPE "public"."capability_method" AS ENUM('GET', 'POST');--> statement-breakpoint
CREATE TYPE "public"."capability_risk" AS ENUM('read', 'write', 'destructive');--> statement-breakpoint
CREATE TABLE "capabilities" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"space_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"input_schema" jsonb NOT NULL,
	"output_schema" jsonb,
	"method" "capability_method" NOT NULL,
	"path" text NOT NULL,
	"risk" "capability_risk" NOT NULL,
	"confidence" double precision NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "capabilities_app_name_idx" ON "capabilities" USING btree ("app_id","name");--> statement-breakpoint
CREATE INDEX "capabilities_app_idx" ON "capabilities" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "capabilities_space_idx" ON "capabilities" USING btree ("space_id");