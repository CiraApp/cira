-- Instances an app keeps running when nobody is asking, so the first request
-- after a quiet spell does not wait for a container to start. Off by default,
-- because it costs money every hour. Additive only.
ALTER TABLE "apps" ADD COLUMN "min_instances" integer DEFAULT 0 NOT NULL;
