-- People give Cira their first and last name, in onboarding and on their
-- profile, and the home page greets them by the first. Kept apart from `name`
-- because the greeting needs the first name on its own, and splitting a full
-- name on its first space is a guess that is wrong for plenty of real names.
ALTER TABLE "users" ADD COLUMN "first_name" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_name" text;
--> statement-breakpoint
-- Names already on record are carried across, so nobody who already has one
-- is asked for it again. This is the one place a name is split on a space,
-- and it is a starting point the person can correct on their profile. An
-- account whose only name is an email address is left without one: greeting
-- someone as their address was the problem this replaces.
UPDATE "users"
SET
  "first_name" = split_part(btrim("name"), ' ', 1),
  "last_name" = NULLIF(btrim(substr(btrim("name"), length(split_part(btrim("name"), ' ', 1)) + 1)), '')
WHERE "name" NOT LIKE '%@%' AND btrim("name") <> '';
