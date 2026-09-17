CREATE TABLE "services" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"slug" text NOT NULL,
	"source_path" text DEFAULT '' NOT NULL,
	"dockerfile" text,
	"port" text,
	"routes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"has_web_ui" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "service_id" text;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "services_app_slug_idx" ON "services" USING btree ("app_id","slug");--> statement-breakpoint
CREATE INDEX "services_app_idx" ON "services" USING btree ("app_id");--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;