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
    /** The provider's own handle for this app, so it can be reconfigured later. */
    providerProjectId: text("provider_project_id"),
    /**
     * Lets Cira open a deployed app on an employee's behalf.
     *
     * The app itself is unreachable without this, so Cira's own permission
     * check is the only way in. Held in plain text for now, which is the weak
     * point: anyone who can read this column can open any app. Encrypting it
     * needs key management that V1 does not have, and it is worth less than it
     * looks while the deploy token in the same environment can already do more.
     */
    accessSecret: text("access_secret"),
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

/**
 * A long-lived credential held by the `cira` CLI on a developer's machine.
 *
 * Only the hash is stored. A stolen database therefore yields no working
 * tokens, and "show me the token again" is impossible by construction rather
 * than by policy.
 */
export const cliTokens = pgTable(
  "cli_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the token. Never the token itself. */
    tokenHash: text("token_hash").notNull(),
    /** Shown when listing or revoking, e.g. the machine it was created on. */
    label: text("label").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cli_tokens_hash_idx").on(t.tokenHash),
    index("cli_tokens_user_idx").on(t.userId),
  ],
);

/**
 * One in-progress `cira login`.
 *
 * The CLI holds the secret device code and polls; the human types only the
 * short user code. Splitting them means the code a person reads aloud or
 * pastes into chat cannot itself be exchanged for a token.
 */
export const cliAuthRequests = pgTable(
  "cli_auth_requests",
  {
    id: text("id").primaryKey(),
    /** Secret, held only by the CLI instance that started the login. */
    deviceCode: text("device_code").notNull(),
    /** Short and human-typable, e.g. "WXYZ-1234". */
    userCode: text("user_code").notNull(),
    label: text("label").notNull(),
    approvedByUserId: text("approved_by_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    /** Set once the CLI has collected its token, so it can never be collected twice. */
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cli_auth_device_idx").on(t.deviceCode),
    uniqueIndex("cli_auth_user_code_idx").on(t.userCode),
  ],
);
