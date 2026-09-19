-- Two more secrets were stored as themselves: the token in an invite link,
-- which admits whoever holds it to a space until it expires, and the device
-- code a `cira login` polls with, which can be exchanged for a CLI token. Both
-- are random values Cira shows once and afterwards only has to recognise, so
-- from here only their SHA-256 is kept, the way CLI tokens already are.
--
-- The hashes are computed here for every existing row and the originals
-- erased in the same step, so no plain copy outlives this migration. The old
-- columns can only become nullable for now: the deployment serving while this
-- runs still writes them, and the next migration drops them once it does not.
ALTER TABLE "invites" ADD COLUMN "token_hash" text;
--> statement-breakpoint
ALTER TABLE "invites" ALTER COLUMN "token" DROP NOT NULL;
--> statement-breakpoint
UPDATE "invites"
SET "token_hash" = encode(sha256(convert_to("token", 'UTF8')), 'hex'), "token" = NULL
WHERE "token" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "invites_token_hash_idx" ON "invites" USING btree ("token_hash");
--> statement-breakpoint
ALTER TABLE "cli_auth_requests" ADD COLUMN "device_code_hash" text;
--> statement-breakpoint
ALTER TABLE "cli_auth_requests" ALTER COLUMN "device_code" DROP NOT NULL;
--> statement-breakpoint
UPDATE "cli_auth_requests"
SET "device_code_hash" = encode(sha256(convert_to("device_code", 'UTF8')), 'hex'), "device_code" = NULL
WHERE "device_code" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "cli_auth_device_hash_idx" ON "cli_auth_requests" USING btree ("device_code_hash");
