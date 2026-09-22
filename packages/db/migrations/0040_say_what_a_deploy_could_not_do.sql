-- What went wrong without stopping a deploy: a worker Google would not
-- create or take down, or workers left on the previous build.
ALTER TABLE "deployments" ADD COLUMN "warning" text;
