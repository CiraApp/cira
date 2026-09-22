-- The address a removed app answered on, so a new app cannot take it while
-- a browser session issued for the old one could still be valid.
ALTER TABLE "removed_apps" ADD COLUMN "slug" text;
