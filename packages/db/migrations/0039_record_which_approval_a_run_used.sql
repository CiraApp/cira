-- Which approval a run used, so the record of who ran what also says that a
-- person agreed to a write an assistant asked for.
ALTER TABLE "invocations" ADD COLUMN "approval_id" text;
