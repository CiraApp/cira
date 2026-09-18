-- A refusal is about the build that gave it, so record which one that was.
--
-- Without this a refused capability had no way back. The only thing that set
-- one to pending again was its path or method changing on a redeploy, so a
-- developer who saw "Refused", let Cira in, and redeployed would find every
-- one of those routes still marked shut - nothing would ever ask again.
-- Knowing the deployment lets a refusal from an older build read as pending
-- the moment a newer one is serving, without anything having to remember to
-- reset it in each place that writes a deployment's status.
ALTER TABLE "capabilities" ADD COLUMN "answered_by" text;
--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_answered_by_deployments_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."deployments"("id") ON DELETE set null ON UPDATE no action;
