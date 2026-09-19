-- Who ran which capability, from where, and how it ended - and never with
-- what input or to what reply. Additive only: a new table and two new types,
-- which the deployment serving while this runs never touches.
CREATE TYPE "public"."invocation_via" AS ENUM('mcp', 'ask', 'console');
--> statement-breakpoint
CREATE TYPE "public"."invocation_outcome" AS ENUM('ran', 'refused', 'pending', 'disabled', 'invalid-input', 'unreachable');
--> statement-breakpoint
CREATE TABLE "invocations" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"app_id" text NOT NULL,
	"capability_id" text,
	"capability_name" text NOT NULL,
	"user_id" text NOT NULL,
	"via" "invocation_via" NOT NULL,
	"outcome" "invocation_outcome" NOT NULL,
	"status" integer,
	"elapsed_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invocations" ADD CONSTRAINT "invocations_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invocations" ADD CONSTRAINT "invocations_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invocations" ADD CONSTRAINT "invocations_capability_id_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capabilities"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invocations" ADD CONSTRAINT "invocations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "invocations_user_time_idx" ON "invocations" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX "invocations_app_time_idx" ON "invocations" USING btree ("app_id","created_at");
