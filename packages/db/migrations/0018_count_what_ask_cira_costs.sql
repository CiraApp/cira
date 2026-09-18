-- Ask Cira keeps conversations in the browser, because answers are made of
-- the company's own data and Cira has only ever stored metadata. This is the
-- whole server-side record of a question: who asked, what it cost, and which
-- capabilities it used - never what was asked or answered.
CREATE TABLE "ask_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"tool_calls" integer DEFAULT 0 NOT NULL,
	"capability_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ask_usage" ADD CONSTRAINT "ask_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "ask_usage_user_time_idx" ON "ask_usage" USING btree ("user_id","created_at");
