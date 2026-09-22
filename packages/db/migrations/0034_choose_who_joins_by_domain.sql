-- Whether anyone with a verified address at the space's domain may join
-- without an invite. It used to be on for every space whose founder had a
-- company-looking address, with no way to turn it off: a founder on a mail
-- provider the short list did not know opened their company to every stranger
-- at that provider. It is now off until an admin turns it on, including for
-- every space that exists, because nobody ever chose it. Additive only.
ALTER TABLE "spaces" ADD COLUMN "join_by_domain" boolean DEFAULT false NOT NULL;

-- People removed from a space, by address, so joining by domain cannot undo
-- the removal. Removing someone is a decision an admin made; a verified
-- address that outlived its owner's job must not be able to reverse it.
CREATE TABLE IF NOT EXISTS "space_join_blocks" (
  "id" text PRIMARY KEY NOT NULL,
  "space_id" text NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "space_join_blocks_space_email_idx" ON "space_join_blocks" ("space_id", "email");
