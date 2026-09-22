-- Why a deploy failed, in plain words, when the provider said: the build
-- failing, or the new version refusing to start. Until now only "failed" was
-- kept, and the person was sent to build logs that, for an app that built fine
-- and would not start, showed nothing but success. Additive only.
ALTER TABLE "deployments" ADD COLUMN "failure_reason" text;
