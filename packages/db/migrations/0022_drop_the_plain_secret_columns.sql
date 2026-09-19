-- The second half of 0020 and 0021. Nothing running selects these columns any
-- more, so they can go.
--
-- First, any invite or login the previous deployment wrote in the minute it
-- overlapped with the release that introduced the hashes: those rows carry the
-- secret and no hash. They are hashed here, so they keep working, before the
-- plain columns are dropped and the hashes become required.
UPDATE "invites"
SET "token_hash" = encode(sha256(convert_to("token", 'UTF8')), 'hex')
WHERE "token_hash" IS NULL AND "token" IS NOT NULL;
--> statement-breakpoint
UPDATE "cli_auth_requests"
SET "device_code_hash" = encode(sha256(convert_to("device_code", 'UTF8')), 'hex')
WHERE "device_code_hash" IS NULL AND "device_code" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "invites" WHERE "token_hash" IS NULL;
--> statement-breakpoint
DELETE FROM "cli_auth_requests" WHERE "device_code_hash" IS NULL;
--> statement-breakpoint
ALTER TABLE "invites" DROP COLUMN "token";
--> statement-breakpoint
ALTER TABLE "invites" ALTER COLUMN "token_hash" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "cli_auth_requests" DROP COLUMN "device_code";
--> statement-breakpoint
ALTER TABLE "cli_auth_requests" ALTER COLUMN "device_code_hash" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "access_secret";
--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "provider_project_id";
