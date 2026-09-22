-- Memory for an app's web service: what a person chose, and what its
-- repository asked for. Both empty means Cira's default, as before.
ALTER TABLE "apps" ADD COLUMN "memory_mib" integer;
ALTER TABLE "apps" ADD COLUMN "declared_memory_mib" integer;
