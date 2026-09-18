import type { AppId, SpaceId } from "./model.js";

/**
 * A capability is one business operation an app already performs, described
 * well enough that an agent can find it and call it.
 *
 * Cira derives these from the code at deploy time; nobody writes them by hand.
 * That is the whole point of the engine, and it is why every field here has to
 * be something analysis can establish from a repository rather than something
 * a developer would have had to declare.
 */

/**
 * A JSON Schema object, kept structural rather than modelled.
 *
 * It is produced by analysis, validated at the edge and handed to agents
 * verbatim; giving it a rich TypeScript shape would buy nothing and would
 * force a translation layer on both sides of that journey.
 */
export type JsonSchema = Record<string, unknown>;

/**
 * Whether invoking this only looks, or changes something.
 *
 * Two grades, because exactly one decision turns on them: a `read` may be
 * called by an agent unattended, and everything else waits for a person. There
 * used to be a third, `destructive`, meant to mark the frightening ones - but
 * it was withheld identically to `write`, so it decided nothing, and three
 * careful readings of the same endpoint disagreed about which it was. A label
 * people learn to ignore is worse than no label; the description says what an
 * operation does, and that warns better than a word ever did.
 */
export type CapabilityRisk = "read" | "write";

/**
 * Where the capability lives in the app.
 *
 * Only HTTP, and only a method and a path: never a full URL. The host is
 * resolved at invocation time from the app's own deployment, which is what
 * makes it impossible for a target to point anywhere but the app it belongs to.
 */
export const CAPABILITY_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export type CapabilityMethod = (typeof CAPABILITY_METHODS)[number];

/**
 * What happened when Cira asked the app about a capability.
 *
 * This was a boolean called `verified`, and the boolean was the bug. Asking
 * "did the app answer for this?" collapsed two different answers into one:
 * an app that served the route and an app that served the route and refused
 * to let Cira through it. Anything but a 404 counted as confirmation, so a
 * 401 published the capability as ready to use.
 *
 * It was not a theoretical hole. Every one of Wave's nineteen enabled reads
 * was published this way, and every one of them returned 401 to the first
 * agent that tried, after Cira had told it they were available. The third
 * state is what stops Cira being confidently wrong about its own shelf:
 * a refusal is a real answer, it is just not a yes.
 */
export type CapabilityReach =
  /** Nothing has asked the app yet. */
  | "pending"
  /** The app answered, so Cira can really call this. */
  | "callable"
  /**
   * The app serves the route and would not let Cira in - almost always
   * because it signs its own users in and Cira is not one of them.
   */
  | "refused";

/**
 * What an app's recorded answer about a capability means now.
 *
 * A refusal is about the build that gave it. When a different deployment is
 * serving, the refusal is history rather than a fact, and it reads as pending
 * so the app is asked again. Without this there was no way out of `refused`:
 * a developer who let Cira in and redeployed would go on being told every
 * one of those routes was shut, because nothing ever asked again unless a
 * route happened to move.
 *
 * Only refusals age this way. A `callable` answer from the previous build is
 * kept, because resetting it would switch off every working capability for
 * the seconds between a deploy going live and the app being asked - and a
 * route that did move is already reset when the new build is analysed.
 *
 * `serving` is the deployment answering requests now, or null when none is
 * (a build in progress, a failed one). With nothing serving there is nobody
 * to ask, so the last answer stands.
 */
export function currentReach(
  answer: { reach: CapabilityReach; answeredBy: string | null },
  serving: string | null,
): CapabilityReach {
  if (answer.reach !== "refused" || serving === null) return answer.reach;
  return answer.answeredBy === serving ? "refused" : "pending";
}

export interface CapabilityTarget {
  type: "http";
  method: CapabilityMethod;
  /** Root-relative, always starting with `/`. */
  path: string;
}

export interface Capability {
  id: string;
  spaceId: SpaceId;
  appId: AppId;
  /** Unique within the app, and how an agent refers to it. */
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema | null;
  target: CapabilityTarget;
  risk: CapabilityRisk;
  enabled: boolean;
  /**
   * What the deployed app said when Cira asked about this.
   *
   * Separate from `enabled` because they say different things. `enabled` is
   * the decision - policy, or a person's - and this is what the app itself
   * reported. Both must hold before an agent is offered anything, and the
   * difference is what lets a page say "checking" rather than "off".
   */
  reach: CapabilityReach;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Whether a freshly detected capability may be used without anyone looking at
 * it first.
 *
 * Reading is recoverable and writing is not, so a read turns itself on and
 * everything else is registered, visible, and switched off until a person
 * decides otherwise.
 *
 * It used to also weigh the analyzer's confidence in itself. It no longer
 * needs to: a capability is not stored at all until the deployed app has
 * answered for it, and an app confirming its own route is better evidence than
 * a number the analyzer chose.
 *
 * Deliberately a pure function of the one fact that matters, so the policy can
 * be read in one place and tested without a database.
 */
export function publicationFor(args: { risk: CapabilityRisk }): {
  enabled: boolean;
  reason: "auto" | "review";
} {
  return args.risk === "read"
    ? { enabled: true, reason: "auto" }
    : { enabled: false, reason: "review" };
}

/**
 * A capability name an agent can refer to and a person can read.
 *
 * Constrained rather than free text because it becomes part of an address an
 * agent asks for by name; anything that would need escaping does not belong
 * in one.
 */
export function isCapabilityName(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_]{1,62}$/.test(value);
}

/**
 * Is this a path this engine is willing to call?
 *
 * The check exists to make one class of bug impossible rather than unlikely:
 * a target that escapes its own app. Absolute URLs, protocol-relative paths,
 * traversal and anything carrying its own host or query are all refused here,
 * long before a request is built.
 */
export function isSafeTargetPath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  // `//host` is protocol-relative and would leave the app entirely.
  if (path.startsWith("//")) return false;
  if (path.includes("..")) return false;
  if (path.includes("://")) return false;
  if (path.includes("?") || path.includes("#")) return false;
  if (/[\s\\]/.test(path)) return false;
  return path.length <= 300;
}

/** What a redeploy should do to one app's capability set. */
export interface Reconciliation<T> {
  /** Detected and not previously known. Takes the publication policy's default. */
  create: Array<{ detected: T; enabled: boolean }>;
  /** Detected and already known. Keeps whatever a person decided. */
  update: Array<{ id: string; detected: T; enabled: boolean }>;
  /** Previously known and no longer in the code. */
  remove: string[];
  enabledCount: number;
  reviewCount: number;
}

/**
 * Work out what a redeploy changes, without touching a database.
 *
 * Two rules, and the second is the one that matters. A capability whose code
 * has gone stops existing, because leaving it behind means offering agents a
 * target that no longer answers. And a capability that survives keeps the
 * decision a person already made about it: re-detecting `createRefund` must
 * never quietly switch it back on, which is exactly what would happen if the
 * publication policy were applied again on every deploy.
 */
export function reconcileCapabilities<T extends { name: string; risk: CapabilityRisk }>(
  existing: readonly { id: string; name: string; enabled: boolean }[],
  detected: readonly T[],
): Reconciliation<T> {
  const previous = new Map(existing.map((row) => [row.name, row]));
  const keep = new Set(detected.map((item) => item.name));

  const result: Reconciliation<T> = {
    create: [],
    update: [],
    remove: existing.filter((row) => !keep.has(row.name)).map((row) => row.id),
    enabledCount: 0,
    reviewCount: 0,
  };

  for (const item of detected) {
    const prior = previous.get(item.name);
    const enabled =
      prior === undefined ? publicationFor({ risk: item.risk }).enabled : prior.enabled;

    if (enabled) result.enabledCount += 1;
    else result.reviewCount += 1;

    if (prior === undefined) result.create.push({ detected: item, enabled });
    else result.update.push({ id: prior.id, detected: item, enabled });
  }

  return result;
}
