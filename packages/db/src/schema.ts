import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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
  "superseded",
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
export const capabilityReachEnum = pgEnum("capability_reach", [
  "pending",
  "callable",
  "refused",
]);

/** What an app runs besides serving requests. See core's processes.ts. */
export const processKindEnum = pgEnum("process_kind", ["worker", "scheduled"]);

/** Where a capability run came from. */
export const invocationViaEnum = pgEnum("invocation_via", ["mcp", "ask", "console"]);

/**
 * How a capability run ended, in Cira's words. `ran` means the app answered,
 * whatever it said - its status is kept beside this. Everything else is a
 * check that stopped the run before anything was sent.
 */
export const invocationOutcomeEnum = pgEnum("invocation_outcome", [
  "ran",
  "refused",
  "pending",
  "disabled",
  "invalid-input",
  "unreachable",
]);

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
    /**
     * How the person is shown everywhere. Kept equal to first and last name
     * once they have given one; before that, whatever the sign-in provider
     * knew - which for an account with no name on it is the email address.
     */
    name: text("name").notNull(),
    /**
     * The name the person gave Cira, in onboarding or on their profile.
     *
     * Cira's rather than the sign-in provider's: once it is set, signing in
     * never overwrites it, because a name someone chose here being replaced by
     * whatever another system happens to hold is a name they cannot keep. Null
     * until they give one.
     */
    firstName: text("first_name"),
    lastName: text("last_name"),
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
     * The company's email domain, when its creator had one. Null for spaces
     * created from a personal address.
     */
    domain: text("domain"),
    /**
     * Whether anyone with a verified address at `domain` may join without an
     * invite, the way a company Slack works. Off until an admin turns it on.
     */
    joinByDomain: boolean("join_by_domain").notNull().default(false),
    /**
     * Which plan it is on: `trial` until somebody pays. What each allows and
     * costs lives in core's plans.ts, not here.
     */
    plan: text("plan").notNull().default("trial"),
    /** The customer Stripe knows this company as. Null until it first pays. */
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    /** Stripe's own word for how the subscription is doing. */
    subscriptionStatus: text("subscription_status"),
    /** What the subscription is paid up to, for a page to say so. */
    paidUntil: timestamp("paid_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("spaces_slug_idx").on(t.slug),
    index("spaces_domain_idx").on(t.domain),
  ],
);

/**
 * Someone removed from a space, by address, so that joining by domain cannot
 * quietly undo the removal. Cleared when they are invited back.
 */
export const spaceJoinBlocks = pgTable(
  "space_join_blocks",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    /** Lowercased. */
    email: text("email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("space_join_blocks_space_email_idx").on(t.spaceId, t.email)],
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
    /**
     * A picture for the app, as a data URL.
     *
     * Kept in the row rather than in a bucket because it is small by
     * construction - the browser redraws whatever was chosen to 128 square and
     * encodes it before it is ever sent, so what arrives is a few kilobytes and
     * a known shape. A bucket would mean an object store, a lifecycle rule, a
     * signing step and a serving route, all to hold something smaller than this
     * app's description.
     *
     * Null is the ordinary case, and the icon above - a letter, or a character
     * somebody picked - is what gets drawn instead.
     */
    image: text("image"),
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
    /**
     * Instances kept running when nobody is asking, so the first request
     * after a quiet spell does not wait for a container to start. Costs money
     * every hour, so it is off unless a paid plan turns it on.
     */
    minInstances: integer("min_instances").notNull().default(0),
    /** Memory a person chose for the web service, per container, in MiB. */
    memoryMiB: integer("memory_mib"),
    /** Memory the repository asked for at its last deploy, settled to a choice. */
    declaredMemoryMiB: integer("declared_memory_mib"),
    /**
     * Whether Cira tells this app who is calling, as a signed assertion it can
     * verify. Off unless the app's managers turned it on: an app that is not
     * expecting one should never start receiving claims about people.
     */
    tellsWhoIsCalling: boolean("tells_who_is_calling").notNull().default(false),
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
/**
 * Addresses an app used to answer on.
 *
 * The slug follows the name, because an app called "Payroll" living at
 * /revenue-dashboard is its own small lie. The cost used to be that renaming
 * broke every link anybody had ever shared - a message in Slack, a bookmark, a
 * line in somebody's runbook - and a rename is the most ordinary edit there
 * is. Warning people about it first is not the same as not doing it to them.
 *
 * So the old address is kept and keeps working. Nothing here grants access:
 * it resolves a name to an app and the usual checks happen afterwards, exactly
 * as they do for the current one.
 */
export const appSlugHistory = pgTable(
  "app_slug_history",
  {
    id: text("id").primaryKey(),
    appId: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One space, one meaning for an address - whether it is in use now or was
    // in use before. This is also what stops a new app quietly taking over a
    // name that still points somewhere.
    uniqueIndex("app_slug_history_space_slug_idx").on(t.spaceId, t.slug),
    index("app_slug_history_app_idx").on(t.appId),
  ],
);

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
    /**
     * `use` opens the app; `manage` also deploys it, sets its variables and
     * changes who sees it. Checked in the database as well as the type.
     */
    level: text("level").$type<"use" | "manage">().notNull().default("use"),
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
    /**
     * Which service this deploy was of. Null on rows written before an app
     * could have more than one, which all belonged to its only service.
     */
    serviceId: text("service_id").references(() => services.id, {
      onDelete: "cascade",
    }),
    providerDeploymentId: text("provider_deployment_id").notNull(),
    /**
     * Whether this deploy has a web process. False for an app that is only a
     * worker or a scheduled script: there is no service, no address and
     * nothing to open, and none of that means the deploy went wrong.
     */
    servesWeb: boolean("serves_web").notNull().default(true),
    status: deploymentStatusEnum("status").notNull().default("queued"),
    url: text("url"),
    /** Why it failed, in plain words, when the provider said. Never logs. */
    failureReason: text("failure_reason"),
    /** What went wrong without stopping it, in the same kind of words. */
    warning: text("warning"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("deployments_app_idx").on(t.appId)],
);

/**
 * One deployable thing inside an app.
 *
 * An app is what a company runs - Wave, the payroll tool, the ticket console -
 * and a great deal of real software is more than one process: a frontend and
 * the API behind it, most commonly. Those are not two entries on a shelf. They
 * are one product, and a shelf that shows the topology instead of the product
 * is a worse shelf.
 *
 * So the app stays the unit people see and this is the unit that gets built,
 * deployed, torn down and reported on. An ordinary single-process app has
 * exactly one of these and nothing about it looks different.
 *
 * They run together, in one Cloud Run service: one container takes the port and
 * the rest sit beside it on localhost. That is what keeps the whole app on a
 * single address - one certificate, one session cookie, no CORS - and it means
 * a frontend already written to proxy to its backend in development works
 * unchanged, because in development it was already talking to localhost.
 */
export const services = pgTable(
  "services",
  {
    id: text("id").primaryKey(),
    appId: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    /** Names it to a person, and forms the first part of any address it has. */
    slug: text("slug").notNull(),
    /** Where in the repository it is built from. Empty string for the root. */
    sourcePath: text("source_path").notNull().default(""),
    /** The Dockerfile it asked to be built with, relative to the repository. */
    dockerfile: text("dockerfile"),
    /** The port its Dockerfile declared, when it declared one. */
    port: text("port"),
    /**
     * Whether this service answers a browser, settled by asking it. The one
     * that does is the app's front door; see `apps.has_web_ui`, which asks the
     * same question of an app with a single service.
     */
    hasWebUi: boolean("has_web_ui"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("services_app_slug_idx").on(t.appId, t.slug),
    index("services_app_idx").on(t.appId),
  ],
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
    /**
     * SHA-256 of the secret in the invite link. The link itself is shown once,
     * to whoever created it, and never stored: a copy of this table admits
     * nobody.
     */
    tokenHash: text("token_hash").notNull(),
    invitedByUserId: text("invited_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("invites_token_hash_idx").on(t.tokenHash),
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
    /**
     * `cli` deploys and removes apps; `assistant` only reaches MCP, as the
     * person. An assistant's config file is not somewhere deploy rights belong.
     */
    scope: text("scope").$type<"cli" | "assistant">().notNull().default("cli"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    /** Ninety days after it was last used. Every use moves it on. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
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
    /**
     * SHA-256 of the device code, the secret held only by the CLI instance
     * that started the login. Kept as a hash for the reason CLI tokens are:
     * the code can be exchanged for a token, so the table must not hold it.
     */
    deviceCodeHash: text("device_code_hash").notNull(),
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
    uniqueIndex("cli_auth_device_hash_idx").on(t.deviceCodeHash),
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
     * When the deployed app last answered about this, or null when nothing has
     * asked it yet. A refusal is an answer, so this is stamped for those too;
     * `reach` is what says which answer it was.
     */
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    /**
     * What the app said. Only `callable` is published or offered to an agent.
     *
     * `refused` exists because the alternative was publishing it anyway: this
     * used to be inferred from `verifiedAt`, which was stamped for anything
     * that was not a 404, so a route the app guards behind its own login was
     * indistinguishable from one Cira could actually call.
     */
    reach: capabilityReachEnum("reach").notNull().default("pending"),
    /**
     * The deployment that gave `reach`.
     *
     * A refusal is about the build that said it. Once a different deployment
     * is serving, it reads as pending again and the app is asked afresh -
     * otherwise the one developer who fixed this, by letting Cira in and
     * redeploying, would go on being told the routes were shut. Null for
     * answers recorded before this existed, which are treated as coming from
     * an older build for the same reason.
     */
    answeredBy: text("answered_by").references(() => deployments.id, {
      onDelete: "set null",
    }),
    /**
     * An example input, for reads, used once to ask the app whether the route
     * is there. Never sent to an agent and never used for a write - a write is
     * confirmed by asking which methods a path allows, not by performing it.
     * The console starts a read's form from it, for a person who may already
     * open the app and so could run that same read themselves.
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

/**
 * One turn of Ask Cira: what it cost, and nothing of what was said.
 *
 * Answers are built from the company's own data - revenue, customers, people -
 * and Cira has only ever kept metadata about the software it runs, never the
 * data inside it. So the conversation lives in the browser tab that holds it,
 * and this is the whole server-side record: enough to enforce a daily limit
 * and to see what the feature costs, and nothing a leak could embarrass anyone
 * with.
 */
export const askUsage = pgTable(
  "ask_usage",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * `question` when someone asked something, `decision` when they answered a
     * confirmation. Only questions count towards the daily limit - running
     * something Cira just asked you to approve should never be what locks you
     * out.
     */
    kind: text("kind").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    toolCalls: integer("tool_calls").notNull().default(0),
    /** Which capabilities were invoked, by id. Which, never with what. */
    capabilityIds: jsonb("capability_ids").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ask_usage_user_time_idx").on(t.userId, t.createdAt)],
);

/**
 * Who ran which capability, from where, and how it ended.
 *
 * The record a company asks for the first time a refund goes out that nobody
 * remembers issuing - and exactly as much as answers that. Never the input and
 * never the reply: those are the app's data, and Cira passes them through
 * rather than keeping them (docs/secrets.md). A capability that is later
 * removed leaves its runs behind under the name it had.
 *
 * Also what the per-person run limit counts, so a run that limit refused is
 * not written: it did not happen, and recording it would let someone who is
 * being limited keep themselves limited.
 */
export const invocations = pgTable(
  "invocations",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    appId: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    capabilityId: text("capability_id").references(() => capabilities.id, {
      onDelete: "set null",
    }),
    capabilityName: text("capability_name").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    via: invocationViaEnum("via").notNull(),
    outcome: invocationOutcomeEnum("outcome").notNull(),
    /** The approval its person gave, for a write an assistant asked for. */
    approvalId: text("approval_id"),
    /** What the app answered with, when it was reached. */
    status: integer("status"),
    elapsedMs: integer("elapsed_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("invocations_user_time_idx").on(t.userId, t.createdAt),
    index("invocations_app_time_idx").on(t.appId, t.createdAt),
  ],
);

/**
 * What an app runs besides answering requests: workers, which run all the
 * time, and scheduled runs, which run to completion on a timetable.
 *
 * Found in the repository at each deploy (a Procfile, fly.toml, a GitHub
 * Actions schedule), never written down for Cira. A redeploy updates what the
 * repository says and keeps what a person decided - switched on, the
 * timetable they set, the time they allowed - and one the repository no
 * longer mentions is removed. Everything starts off: it runs code nobody is
 * watching, and a worker costs money every hour it is on.
 */
export const processes = pgTable(
  "processes",
  {
    id: text("id").primaryKey(),
    appId: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: processKindEnum("kind").notNull(),
    command: text("command").notNull(),
    /** Which of the app's images it runs in, by service slug. */
    serviceSlug: text("service_slug").notNull(),
    /** Five-field cron in UTC. Null for a worker, or a run nobody has timed yet. */
    schedule: text("schedule"),
    /** Set when a person chose the timetable, so a redeploy keeps theirs. */
    scheduleSetAt: timestamp("schedule_set_at", { withTimezone: true }),
    /** How long each run may take, as asked for. Null for the default. */
    timeoutMinutes: integer("timeout_minutes"),
    /** MiB, one of the sizes Cira offers. Null for the default. */
    memoryMiB: integer("memory_mib"),
    /** Set when a person chose the memory, so a redeploy keeps theirs. */
    memorySetAt: timestamp("memory_set_at", { withTimezone: true }),
    enabled: boolean("enabled").notNull().default(false),
    /** Where it was found: Procfile, fly.toml or GitHub Actions. */
    source: text("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("processes_app_name_idx").on(t.appId, t.name),
    index("processes_space_idx").on(t.spaceId),
  ],
);

/**
 * Everything Cira has told people about by email, one row per event.
 *
 * The row is written before the email is sent, under a unique key naming the
 * event - this deploy failed, this run failed, this capability was refused,
 * this spell of not answering - so whichever of several paths notices it
 * first sends it, and every other finds the row and sends nothing. What was
 * said is not kept; only that it was, to whom many, and whether it went.
 */
/**
 * A person agreeing, in Cira, to one change an assistant asked to make over
 * MCP. Bound to the person, the capability and the exact input, used once,
 * and good for fifteen minutes. The input is kept so the person can see what
 * they are agreeing to; it is what the assistant proposed, not what the app
 * returned.
 */
export const approvals = pgTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    capabilityId: text("capability_id")
      .notNull()
      .references(() => capabilities.id, { onDelete: "cascade" }),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    inputHash: text("input_hash").notNull(),
    via: text("via").notNull(),
    status: text("status")
      .$type<"pending" | "approved" | "denied" | "used">()
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [index("approvals_user_idx").on(t.userId, t.createdAt)],
);

/**
 * An app that was removed, kept so the month's usage still counts what it ran:
 * the names Google knows its services and processes by, and their memory.
 */
export const removedApps = pgTable(
  "removed_apps",
  {
    /** The app's own id, which it no longer has anywhere else. */
    id: text("id").primaryKey(),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    resources: jsonb("resources")
      .$type<Array<{ name: string; memoryMiB: number }>>()
      .notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("removed_apps_space_idx").on(t.spaceId, t.removedAt)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    /** The app it is about, or null for a notice about the whole space. */
    appId: text("app_id").references(() => apps.id, { onDelete: "cascade" }),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    /** deploy-failed, app-down, run-failed, trial-ending, payment-failed and so on. */
    kind: text("kind").notNull(),
    /** Which one: a deployment id, a run id, a capability, a spell's start. */
    subject: text("subject").notNull(),
    /** What it is about within the app - web, one worker, one run - for holding back floods. */
    topic: text("topic"),
    recipients: integer("recipients").notNull().default(0),
    /** What was to be sent, kept so a failed send can be tried again. */
    message: jsonb("message").$type<{ subject: string; text: string; html: string }>(),
    /** Who it has not reached yet. Empty once everyone has it, or it is given up on. */
    unsent: text("unsent").array().notNull().default([]),
    attempts: integer("attempts").notNull().default(0),
    /** Set once the email provider accepted it for everyone. */
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** Why it did not go, in Cira's words. Never the provider's. */
    failure: text("failure"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("notifications_event_idx").on(t.appId, t.kind, t.subject),
    uniqueIndex("notifications_space_event_idx")
      .on(t.spaceId, t.kind, t.subject)
      .where(sql`${t.appId} IS NULL`),
    index("notifications_space_idx").on(t.spaceId),
  ],
);

/**
 * What the watcher last saw of each thing it watches on an app: its web
 * address, and each worker. Kept so that one missed answer is a blip and two
 * in a row are an outage, and so an outage is reported once when it starts
 * and once when it ends.
 */
export const appWatch = pgTable(
  "app_watch",
  {
    appId: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    /** "web", or "worker:<name>". */
    target: text("target").notNull(),
    /** Checks in a row that found it not answering. */
    failures: integer("failures").notNull().default(0),
    /** When the current outage began; null while it is fine. */
    downSince: timestamp("down_since", { withTimezone: true }),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("app_watch_target_idx").on(t.appId, t.target)],
);
