-- A deploy that a newer one of the same app replaced before it finished. Not a
-- failure - nothing went wrong, and nobody should be emailed about it - and
-- never rolled out, so an older build finishing late cannot take production
-- back to older code. Additive only.
ALTER TYPE "deployment_status" ADD VALUE IF NOT EXISTS 'superseded';
