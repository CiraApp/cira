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

export interface User {
  id: UserId;
  name: string;
  email: string;
  createdAt: Date;
}

export interface Space {
  id: SpaceId;
  name: string;
  slug: string;
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

export type AppStatus = "draft" | "deploying" | "live" | "failed";

export interface App {
  id: AppId;
  spaceId: SpaceId;
  name: string;
  slug: string;
  description: string | null;
  status: AppStatus;
  icon: string | null;
  ownerUserId: UserId;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Who can see and open an app.
 *
 * `space` grants every member of the app's space. `user` grants one person.
 * Group support is deliberately absent until it is actually needed.
 */
export type AccessType = "user" | "space";

export interface AppAccess {
  id: string;
  appId: AppId;
  type: AccessType;
  /** A UserId for `user`, a SpaceId for `space`. */
  targetId: string;
}

export type DeploymentStatus =
  "queued" | "building" | "deploying" | "live" | "failed" | "removed";

export interface Deployment {
  id: string;
  appId: AppId;
  provider: string;
  providerDeploymentId: string;
  status: DeploymentStatus;
  url: string | null;
  createdAt: Date;
  updatedAt: Date;
}
