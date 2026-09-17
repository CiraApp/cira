-- Every app that already existed had exactly one service. Give it a row, so
-- that "an app's services" is a question with the same shape everywhere and
-- nothing downstream has to carry a second path for apps deployed before this.
--
-- Named `app` rather than `web`, because that is what it was: the whole app,
-- not a part of one that happened to serve pages. Its routes stay empty, which
-- reads as "everything not claimed by another service", and since it is the
-- only service that is all of it.
INSERT INTO services (id, app_id, slug, source_path, has_web_ui, created_at, updated_at)
SELECT
  'svc_' || replace(gen_random_uuid()::text, '-', ''),
  a.id,
  'app',
  '',
  a.has_web_ui,
  a.created_at,
  a.updated_at
FROM apps a;
--> statement-breakpoint
-- And point the deploys at it. Each app has exactly one service at this moment,
-- so there is no ambiguity about which one every past deploy belonged to.
UPDATE deployments d
SET service_id = s.id
FROM services s
WHERE s.app_id = d.app_id
  AND d.service_id IS NULL;
