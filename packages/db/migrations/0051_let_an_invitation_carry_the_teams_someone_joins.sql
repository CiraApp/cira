CREATE TABLE IF NOT EXISTS "invite_teams" (
	"id" text PRIMARY KEY NOT NULL,
	"invite_id" text NOT NULL,
	"team_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invite_teams" ADD CONSTRAINT "invite_teams_invite_id_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."invites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_teams" ADD CONSTRAINT "invite_teams_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invite_teams_idx" ON "invite_teams" USING btree ("invite_id","team_id");
