-- Whether Cira tells an app who is calling, as a signed assertion the app
-- verifies against Cira's published keys. Off for every app that exists: an
-- app not expecting a claim about a person should never start getting one.
-- Additive only.
ALTER TABLE "apps" ADD COLUMN "tells_who_is_calling" boolean DEFAULT false NOT NULL;
