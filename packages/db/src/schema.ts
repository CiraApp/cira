import {
  boolean,
  doublePrecision,
  index,
  jsonb,
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

export const accessTypeEnum = pgEnum("access_type", ["user", "space", "team"]);

export const capabilityRiskEnum = pgEnum("capability_risk", [
  "read",
  "write",
  "destructive",
]);

/**
 * Widened past GET and POST because an analyzer that reads source finds what
 * apps really serve, and a great many operations are a PATCH or a DELETE.
 * Adding values to an enum is additive; nothing already stored changes.
 */
export const capabilityMethodEnum = pgEnum("capability_method", [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

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

/**
 * A team inside a company: Engineering, Support, Finance.
 *
 * Teams exist because access grants outlive the people in them. "Everyone in
 * Support can open the ticket console" stays true when Support hires; a list
 * of eleven names does not, and the day it stops being true is the day nobody
 * notices. A team is therefore a *target* for a grant and nothing else - it
 * carries no role and no permissions of its own.
 */
export const teams = pgTable(
  "teams",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("teams_space_slug_idx").on(t.spaceId, t.slug),
    index("teams_space_idx").on(t.spaceId),
  ],
);

/**
 * Who is on a team.
 *
 * Deliberately not a column on `memberships`: people belong to more than one
 * team, and the day someone moves from Support to Engineering their old
 * grants should follow the move without anyone editing an app.
 */
export const teamMembers = pgTable(
  "team_members",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("team_members_unique_idx").on(t.teamId, t.userId),
    index("team_members_user_idx").on(t.userId),
    index("team_members_team_idx").on(t.teamId),
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
    /**
     * The app's real front door, when it is somewhere Cira does not host.
     *
     * An app entry on the shelf is a thing the company runs, and the thing a
     * person clicks should be the thing they use. A product whose frontend
     * already lives elsewhere and whose API is the half deployed here would
     * otherwise open onto its API, which serves JSON and has no homepage.
     *
     * Null means the ordinary case: Cira serves this app and opening it goes
     * through the proxy.
     */
    homepageUrl: text("homepage_url"),
    /**
     * Whether the running app answers a browser at all.
     *
     * Settled by asking it rather than by guessing from the source, for the
     * same reason capabilities are: the app is the only thing that knows. Null
     * until something has asked, and null is read as "assume it does" - wrongly
     * hiding the way into a working app is worse than offering a door that
     * turns out to be a 404.
     */
    hasWebUi: boolean("has_web_ui"),
    /**
     * When the analyzer last read this app's source and finished.
     *
     * The difference between "nothing to offer" and "nobody has looked", which
     * an empty capability list cannot tell you and which are opposite things to
     * say to somebody. An app whose analysis never ran - the model refused, the
     * account was out of credit, the upload had gone - looks exactly like one
     * that genuinely serves no routes, and only one of those is worth offering
     * to try again.
     *
     * Set on a run that produced an answer, whether or not the answer had
     * anything in it.
     */
    capabilitiesAnalyzedAt: timestamp("capabilities_analyzed_at", {
      withTimezone: true,
    }),
    /**
     * Both dead. Nothing reads or writes either any more.
     *
     * They belonged to a provider that needed a per-app project and a shared
     * secret to open it. Cira now calls each app with an identity token minted
     * for that app's own URL and expiring in an hour, so there is no long-lived
     * value to keep - which was the acknowledged weak point of `accessSecret`,
     * held in plain text because encrypting it needed key management V1 did
     * not have.
     *
     * Still here because migrations expand before they contract: dropping a
     * column in the same release that stops using it breaks the deployment
     * still serving during the rollover. They go in a later migration, once
     * nothing running has ever read them.
     */
    providerProjectId: text("provider_project_id"),
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
    /** A user id for `user`, a space id for `space`, a team id for `team`. */
    targetId: text("target_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("app_access_unique_idx").on(t.appId, t.type, t.targetId),
    index("app_access_app_idx").on(t.appId),
  ],
);

/**
 * One environment variable an app is deployed with - the fact of it, never the
 * value.
 *
 * Cira passes values to the provider and keeps none: see docs/secrets.md. What
 * is here is what the app page needs to show what is configured, plus enough to
 * see that a value changed between deploys without being able to recover it.
 */
export const appEnvVars = pgTable(
  "app_env_vars",
  {
    id: text("id").primaryKey(),
    appId: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    /**
     * First 8 hex of the SHA-256 of the value. Enough to tell that a value
     * changed, far too little to recover one - a full digest of a short or
     * guessable secret is worth brute-forcing, and eight characters is not.
     */
    fingerprint: text("fingerprint").notNull(),
    /** `NEXT_PUBLIC_*`, which the build inlines into the browser bundle. */
    isPublic: boolean("is_public").notNull().default(false),
    setByUserId: text("set_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("app_env_vars_app_key_idx").on(t.appId, t.key),
    index("app_env_vars_app_idx").on(t.appId),
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

/**
 * When someone last opened an app.
 *
 * One row per person per app rather than a log: the product needs "what do I
 * reach for", not an audit trail, and a log would grow without bound for an
 * answer nobody asks of it.
 */
export const appOpens = pgTable(
  "app_opens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    appId: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("app_opens_user_app_idx").on(t.userId, t.appId),
    index("app_opens_user_idx").on(t.userId),
  ],
);

/**
 * What an app can do, as discovered from its code when it was deployed.
 *
 * Owned by the app, so it inherits the app's access rules exactly: there is no
 * separate capability-level permission model, and there deliberately is not
 * one. Someone who cannot open the app cannot see or call what it can do.
 *
 * `name` is unique per app because it is how an agent refers to the thing. A
 * redeploy replaces the set: a capability whose code is gone should stop
 * existing rather than linger as a target that no longer answers.
 */
export const capabilities = pgTable(
  "capabilities",
  {
    id: text("id").primaryKey(),
    appId: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    /** Denormalised from the app so a space-wide search is one query. */
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull(),
    inputSchema: jsonb("input_schema").notNull(),
    outputSchema: jsonb("output_schema"),
    method: capabilityMethodEnum("method").notNull(),
    /** Root-relative and never a full URL: the host comes from the deployment. */
    path: text("path").notNull(),
    risk: capabilityRiskEnum("risk").notNull(),
    /**
     * Dead. Publication once weighed how sure the analyzer said it was; a
     * capability is now confirmed by asking the deployed app whether it serves
     * the route, which is better evidence than a number. Nullable rather than
     * dropped, because expanding precedes contracting.
     */
    confidence: doublePrecision("confidence"),
    /**
     * When the deployed app answered for this, or null when nothing has asked
     * it yet. Nothing unverified is published or offered to an agent.
     */
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    /**
     * An example input, for reads, used once to ask the app whether the route
     * is there. Never sent to an agent and never used for a write - a write is
     * confirmed by asking which methods a path allows, not by performing it.
     */
    probe: jsonb("probe").$type<Record<string, unknown>>(),
    enabled: boolean("enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("capabilities_app_name_idx").on(t.appId, t.name),
    index("capabilities_app_idx").on(t.appId),
    index("capabilities_space_idx").on(t.spaceId),
  ],
);
