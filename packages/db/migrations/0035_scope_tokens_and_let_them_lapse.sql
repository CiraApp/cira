-- What a token may do, and when it stops working.
--
-- `scope`: a `cli` token deploys and removes apps; an `assistant` token only
-- reaches MCP, as the person, under their permissions. They used to be the
-- same credential, so a token pasted into an assistant's config could tear
-- down every app its owner managed. Every token that exists is left as `cli`,
-- which is what it could already do.
--
-- `expires_at`: tokens used to be good forever. A token now lapses after
-- ninety days without use, and each use moves that on, so a machine or a CI
-- job in regular use never notices. Existing tokens get their ninety days
-- from their last use, or from when they were made. Additive only.
ALTER TABLE "cli_tokens" ADD COLUMN "scope" text DEFAULT 'cli' NOT NULL;
ALTER TABLE "cli_tokens" ADD CONSTRAINT "cli_tokens_scope_check" CHECK ("scope" IN ('cli', 'assistant'));
ALTER TABLE "cli_tokens" ADD COLUMN "expires_at" timestamp with time zone;
UPDATE "cli_tokens" SET "expires_at" = COALESCE("last_used_at", "created_at") + interval '90 days' WHERE "expires_at" IS NULL;
