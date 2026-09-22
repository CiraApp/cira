/**
 * Cira's domain model.
 *
 * Deliberately small: a user belongs to spaces, a space holds apps, and an
 * app is visible to whoever its access rules name. Nothing here knows about
 * containers, regions, or any particular cloud.
 */

export type UserId = string;
export type SpaceId = string;
export type AppId = string;
export type TeamId = string;

export interface User {
  id: UserId;
  /** How they are shown. See `users.name`. */
  name: string;
  /** The name they gave Cira, or null until they give one. */
  firstName?: string | null;
  lastName?: string | null;
  email: string;
  createdAt: Date;
}

export interface Space {
  id: SpaceId;
  name: string;
  slug: string;
  /**
   * The company's email domain, when its founder had one.
   *
   * Anyone with a verified address here joins without an invite, so this is
   * part of what a space IS rather than a setting hung off it. Null for a
   * space created from a personal address.
   */
  domain: string | null;
  /** Whether a verified address at `domain` joins without an invite. */
  joinByDomain: boolean;
  /** Which plan it is on; what each allows and costs is in plans.ts. */
  plan: string;
  /** What Stripe knows it as, and how its subscription is doing. Null until it pays. */
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
  paidUntil: Date | null;
  createdAt: Date;
}

/** Ordered least to most privileged; `roleAtLeast` relies on this order. */
export const ROLES = ["member", "admin", "owner"] as const;
export type Role = (typeof ROLES)[number];

export interface Membership {
  id: string;
  userId: UserId;
  spaceId: SpaceId;
  role: Role;
}

/**
 * A named group of people inside a space.
 *
 * A team is something to point a grant at, not a level of privilege: it has no
 * role, and being on one confers nothing by itself. That is what keeps the
 * permission model one question deep - a person can open an app because the
 * app names them, names a team they are on, or names the whole space.
 */
export interface Team {
  id: TeamId;
  spaceId: SpaceId;
  name: string;
  slug: string;
  description: string | null;
  createdAt: Date;
}

export type AppStatus = "draft" | "deploying" | "live" | "failed";

export interface App {
  id: AppId;
  spaceId: SpaceId;
  name: string;
  slug: string;
  description: string | null;
  status: AppStatus;
  icon: string | null;
  /** A picture for the app, as a data URL. Null means draw the icon. */
  image: string | null;
  ownerUserId: UserId;
  /** Where the app really lives, when Cira is not what serves it. */
  homepageUrl: string | null;
  /** Whether the running app answers a browser. Null until it has been asked. */
  hasWebUi: boolean | null;
  /** Instances kept warm for it. Zero unless a paid plan turned it on. */
  minInstances: number;
  /** Memory a person chose for its web service, per container. Null: not chosen. */
  memoryMiB: number | null;
  /** Memory its repository asked for, as of the last deploy. Null: it did not say. */
  declaredMemoryMiB: number | null;
  /** Whether Cira tells it who is calling, signed, for it to verify. */
  tellsWhoIsCalling: boolean;
  /** When the analyzer last finished. Null means nobody has read this code. */
  capabilitiesAnalyzedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * One deployable thing inside an app.
 *
 * The app is what a company runs and what a person clicks; this is what gets
 * built and deployed. Most apps have exactly one and nobody ever thinks about
 * it. An app with a frontend and an API behind it has two, on one address,
 * told apart by the paths each one answers.
 */
export interface Service {
  id: string;
  appId: AppId;
  slug: string;
  /** Where in the repository it is built from. Empty for the root. */
  sourcePath: string;
  dockerfile: string | null;
  port: string | null;
  /** Whether it answers a browser. Null until it has been asked. */
  hasWebUi: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Who can see and open an app.
 *
 * `space` grants every member of the app's space, `team` grants everyone on a
 * team, and `user` grants one person. The three are checked with an or, never
 * a precedence: there is no such thing as a grant that takes access away, so
 * the order they are evaluated in cannot matter.
 */
export type AccessType = "user" | "space" | "team";

/**
 * What a grant allows. `use` opens the app and runs what it can do; `manage`
 * also deploys it, sets its variables and decides who else may use it.
 */
export type AccessLevel = "use" | "manage";

export interface AppAccess {
  id: string;
  appId: AppId;
  type: AccessType;
  /** A UserId for `user`, a SpaceId for `space`, a TeamId for `team`. */
  targetId: string;
  level: AccessLevel;
}

/**
 * `superseded` is a deploy a newer one of the same app replaced before it
 * finished: never rolled out, and not a failure.
 */
export type DeploymentStatus =
  "queued" | "building" | "deploying" | "live" | "failed" | "removed" | "superseded";

export interface Deployment {
  id: string;
  appId: AppId;
  provider: string;
  providerDeploymentId: string;
  status: DeploymentStatus;
  url: string | null;
  /** False for an app that is only workers or scheduled runs: nothing to open. */
  servesWeb: boolean;
  /** Why it failed, in plain words, when that is known. */
  failureReason: string | null;
  /**
   * Something that went wrong without stopping the deploy: a worker Google
   * would not create or take down, workers left on the previous build.
   */
  warning: string | null;
  createdAt: Date;
  updatedAt: Date;
}
