-- A company signing in through its own identity provider, and keeping its
-- people in step with Cira over SCIM.
CREATE TABLE "space_sso" (
  "space_id" text PRIMARY KEY NOT NULL,
  "connection_id" text NOT NULL,
  "domain" text NOT NULL,
  "idp_metadata_url" text,
  "active" boolean DEFAULT false NOT NULL,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "space_scim" (
  "space_id" text PRIMARY KEY NOT NULL,
  "token_hash" text NOT NULL,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone,
  CONSTRAINT "space_scim_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "scim_users" (
  "id" text PRIMARY KEY NOT NULL,
  "space_id" text NOT NULL,
  "external_id" text,
  "user_name" text NOT NULL,
  "given_name" text,
  "family_name" text,
  "active" boolean DEFAULT true NOT NULL,
  "user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scim_groups" (
  "id" text PRIMARY KEY NOT NULL,
  "space_id" text NOT NULL,
  "external_id" text,
  "display_name" text NOT NULL,
  "team_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scim_group_members" (
  "group_id" text NOT NULL,
  "scim_user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "space_sso" ADD CONSTRAINT "space_sso_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "space_sso" ADD CONSTRAINT "space_sso_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "space_scim" ADD CONSTRAINT "space_scim_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "space_scim" ADD CONSTRAINT "space_scim_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scim_users" ADD CONSTRAINT "scim_users_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scim_users" ADD CONSTRAINT "scim_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scim_groups" ADD CONSTRAINT "scim_groups_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scim_groups" ADD CONSTRAINT "scim_groups_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scim_group_members" ADD CONSTRAINT "scim_group_members_group_id_scim_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."scim_groups"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scim_group_members" ADD CONSTRAINT "scim_group_members_scim_user_id_scim_users_id_fk" FOREIGN KEY ("scim_user_id") REFERENCES "public"."scim_users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "scim_users_space_user_name_idx" ON "scim_users" USING btree ("space_id","user_name");
--> statement-breakpoint
CREATE INDEX "scim_users_user_name_idx" ON "scim_users" USING btree ("user_name");
--> statement-breakpoint
CREATE INDEX "scim_groups_space_idx" ON "scim_groups" USING btree ("space_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "scim_group_members_idx" ON "scim_group_members" USING btree ("group_id","scim_user_id");
