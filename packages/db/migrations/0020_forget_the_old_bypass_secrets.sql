-- `apps.access_secret` held the old deployment provider's protection-bypass
-- secret, in plain text, and `apps.provider_project_id` the project it opened.
-- Nothing has read either since apps moved to Cloud Run and are opened with an
-- identity token minted per app and expiring within the hour.
--
-- The values are erased now rather than when the columns go, because a secret
-- nothing uses is only a liability. The columns themselves are dropped by the
-- next migration, once no running deployment selects them: migrations run
-- before new code is live, and the deployment serving during this one still
-- does.
UPDATE "apps"
SET "access_secret" = NULL, "provider_project_id" = NULL
WHERE "access_secret" IS NOT NULL OR "provider_project_id" IS NOT NULL;
