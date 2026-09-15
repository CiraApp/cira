import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Cira owns identity's *consequences* - spaces, membership, access - while an
 * external provider answers only "who is this person". `users.externalId` is
 * that seam, and nothing else in the schema knows the provider exists.
 */

export const roleEnum = pgEnum("role", ["member", "admin", "owner"]);

export const appStatusEnum = pgEnum("app_status", [
  "draft",
  "deploying",
  "live",
  "failed",
]);

export const deploymentStatusEnum = pgEnum("deployment_status", [
  "queued",
  "building",
  "deploying",
  "live",
  "failed",
  "removed",
]);

export const accessTypeEnum = pgEnum("access_type", ["user", "space"]);

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    imageUrl: text("image_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_external_id_idx").on(t.externalId),
    uniqueIndex("users_email_idx").on(t.email),
  ],
);

export const spaces = pgTable(
  "spaces",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /**
     * The company's email domain, when its creator had one. Anyone with a
     * verified address here can join without an individual invite, the way a
     * company Slack works. Null for spaces created from a personal address.
     */
    domain: text("domain"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("spaces_slug_idx").on(t.slug),
    index("spaces_domain_idx").on(t.domain),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("memberships_user_space_idx").on(t.userId, t.spaceId),
    index("memberships_space_idx").on(t.spaceId),
  ],
);

export const apps = pgTable(
  "apps",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    status: appStatusEnum("status").notNull().default("draft"),
    icon: text("icon"),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("apps_space_slug_idx").on(t.spaceId, t.slug),
    index("apps_space_idx").on(t.spaceId),
  ],
);

/**
 * A row here is a grant. No row means no access: membership in the space is a
 * precondition, never a grant on its own.
 */
export const appAccess = pgTable(
  "app_access",
  {
    id: text("id").primaryKey(),
    appId: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    type: accessTypeEnum("type").notNull(),
    /** A user id for `user`, a space id for `space`. */
    targetId: text("target_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("app_access_unique_idx").on(t.appId, t.type, t.targetId),
    index("app_access_app_idx").on(t.appId),
  ],
);

export const deployments = pgTable(
  "deployments",
  {
    id: text("id").primaryKey(),
    appId: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerDeploymentId: text("provider_deployment_id").notNull(),
    status: deploymentStatusEnum("status").notNull().default("queued"),
    url: text("url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("deployments_app_idx").on(t.appId)],
);

export const invites = pgTable(
  "invites",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: roleEnum("role").notNull().default("member"),
    token: text("token").notNull(),
    invitedByUserId: text("invited_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("invites_token_idx").on(t.token),
    index("invites_space_idx").on(t.spaceId),
    index("invites_email_idx").on(t.email),
  ],
);
