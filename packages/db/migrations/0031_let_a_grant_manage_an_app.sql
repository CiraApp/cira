-- What a grant on an app allows: opening it, or also managing it - deploying,
-- setting its variables, changing who sees it. Until now only the app's owner
-- and the space's admins could manage an app, so a team of engineers sharing
-- one had to route every deploy through one person. Every grant that exists
-- stays exactly what it was: a right to open the app. Additive only.
ALTER TABLE "app_access" ADD COLUMN "level" text DEFAULT 'use' NOT NULL;
ALTER TABLE "app_access" ADD CONSTRAINT "app_access_level_check" CHECK ("level" IN ('use', 'manage'));
