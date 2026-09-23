-- A rollback says which deploy it put the app back on.
ALTER TABLE "deployments" ADD COLUMN "restored_from_id" text;
