-- A person agreeing, in Cira, to one change an assistant asked to make.
--
-- Writes over MCP used to run as soon as an assistant asked, with the only
-- check being whatever the assistant's own client did - and a person who had
-- clicked "always allow" once had no check at all. Now a write asked for over
-- MCP waits here until the person it acts for approves it on a page in Cira.
-- An approval names the person, the capability and the exact input (by
-- hash), works once, and lapses after fifteen minutes. Additive only.
CREATE TABLE IF NOT EXISTS "approvals" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "capability_id" text NOT NULL REFERENCES "capabilities"("id") ON DELETE CASCADE,
  "input" jsonb NOT NULL,
  "input_hash" text NOT NULL,
  "via" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "decided_at" timestamp with time zone,
  "used_at" timestamp with time zone,
  CONSTRAINT "approvals_status_check" CHECK ("status" IN ('pending', 'approved', 'denied', 'used'))
);
CREATE INDEX IF NOT EXISTS "approvals_user_idx" ON "approvals" ("user_id", "created_at");
