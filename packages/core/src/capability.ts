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
/**
 * What an operation's risk is, whatever it was said to be.
 *
 * The analyzer is a model, and a model can call `DELETE /users/{id}` a read -
 * because its description sounds like a lookup, or because a comment in the
 * code told it to. A read switches itself on and runs without anyone agreeing
 * to it, so that mistake is the dangerous one. Anything but GET and HEAD is a
 * write, full stop. A GET may still be graded a write, which is the careful
 * direction: some GETs do change things.
 */
export function riskFor(method: string, claimed: CapabilityRisk): CapabilityRisk {
  const safe = method.toUpperCase() === "GET" || method.toUpperCase() === "HEAD";
  return safe ? claimed : "write";
}

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
  // `//host` is protocol-relative and would leave the app entirely; `//`
  // anywhere else is an empty segment, which servers collapse, so the call
  // lands on a different route than the one it names.
  if (path.includes("//")) return false;
  if (path.includes("..")) return false;
  // A `.` segment is collapsed the same way: `/orders/./refund` is
  // `/orders/refund`, a route nobody meant to reach with an order id.
  if (path.split("/").some((segment) => segment === ".")) return false;
  if (path.includes("://")) return false;
  if (path.includes("?") || path.includes("#")) return false;
  if (/[\s\\]/.test(path)) return false;
  return path.length <= 300;
}

/** `{order_id}` or `:order_id`, the two ways a path names a parameter. */
const PATH_PARAMETER = /\{([^}/]+)\}|:([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * A capability's path with its parameters put in.
 *
 * `/orders/{order_id}` is an address with a hole in it, and the value for the
 * hole arrives in the input. Each one is encoded, so a value can never carry a
 * slash, a query or a fragment into the address; the caller still re-checks
 * the finished path with `isSafeTargetPath`, which is what refuses a value of
 * `..`. `used` names the inputs that went into the path, so they are not sent
 * a second time in the query or the body.
 *
 * `fallback` fills a hole nothing was given for. Verification passes one,
 * because it has to ask about a route before anyone has asked it anything;
 * invocation does not, and an unfilled hole is left in place for it to refuse.
 */
export function fillTargetPath(
  path: string,
  values: Record<string, unknown>,
  fallback?: string,
): { path: string; used: string[]; missing: string[] } {
  const used: string[] = [];
  const missing: string[] = [];

  const filled = path.replace(
    PATH_PARAMETER,
    (whole: string, braced?: string, colon?: string) => {
      const key = (braced ?? colon) as string;
      const given = values[key];
      // An empty string is no value: it would leave an empty segment.
      if (
        (typeof given === "string" && given !== "") ||
        typeof given === "number" ||
        typeof given === "boolean"
      ) {
        used.push(key);
        return encodeURIComponent(String(given));
      }
      if (fallback !== undefined) return encodeURIComponent(fallback);
      missing.push(key);
      return whole;
    },
  );

  return { path: filled, used, missing };
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
 *
 * A capability is the same one when it has the same name, or - when the name
 * is new - when it is served at the same method and path as one that is gone.
 * Names are chosen by a model reading the code, and the same code read twice
 * came back as `listOrders` and then `getOrders`. Matched by name alone,
 * that was a new capability: a write someone had switched on went back to
 * review, every agent that knew the old name lost it, and a route that started
 * refusing Cira was never noticed, since nothing had been callable before it.
 * A route match keeps the name agents already know.
 */
export function reconcileCapabilities<
  T extends { name: string; risk: CapabilityRisk; method: string; path: string },
>(
  existing: readonly {
    id: string;
    name: string;
    enabled: boolean;
    /** As stored, which can be older than today's two grades. */
    risk?: string;
    method?: string;
    path?: string;
  }[],
  detected: readonly T[],
): Reconciliation<T> {
  const byName = new Map(existing.map((row) => [row.name, row]));
  const matched = new Map<T, (typeof existing)[number]>();
  for (const item of detected) {
    const prior = byName.get(item.name);
    if (prior !== undefined) matched.set(item, prior);
  }

  // Then renames: one route left unclaimed on each side. Two candidates on
  // either side is a guess, and a guess could hand one operation's decision to
  // another, so those stay new.
  const claimed = new Set([...matched.values()].map((row) => row.id));
  const route = (method: string | undefined, path: string | undefined) =>
    method === undefined || path === undefined ? null : `${method} ${path}`;
  const unmatched = detected.filter((item) => !matched.has(item));
  for (const item of unmatched) {
    const at = route(item.method, item.path);
    const rows = existing.filter(
      (row) => !claimed.has(row.id) && route(row.method, row.path) === at,
    );
    const rivals = unmatched.filter((other) => route(other.method, other.path) === at);
    const [prior] = rows;
    if (at === null || prior === undefined || rows.length > 1 || rivals.length > 1)
      continue;
    matched.set(item, prior);
    claimed.add(prior.id);
  }

  const result: Reconciliation<T> = {
    create: [],
    update: [],
    remove: existing.filter((row) => !claimed.has(row.id)).map((row) => row.id),
    enabledCount: 0,
    reviewCount: 0,
  };

  for (const found of detected) {
    const prior = matched.get(found);
    const item = prior === undefined ? found : { ...found, name: prior.name };
    // A decision a person made survives a redeploy - but only about the thing
    // they decided on. A read that has become a write, or a write that now
    // points somewhere else, is not what anyone agreed to, and goes back to
    // waiting for review. Otherwise `syncInventory` switching from GET to POST
    // stayed on, and so did `refundOrder` quietly moving to `/refunds/bulk`.
    const riskRose = prior?.risk === "read" && item.risk === "write";
    const writeMoved =
      item.risk === "write" &&
      prior !== undefined &&
      (prior.method !== undefined || prior.path !== undefined) &&
      (prior.method !== item.method || prior.path !== item.path);
    const enabled =
      prior === undefined || riskRose || writeMoved
        ? publicationFor({ risk: item.risk }).enabled
        : prior.enabled;

    if (enabled) result.enabledCount += 1;
    else result.reviewCount += 1;

    if (prior === undefined) result.create.push({ detected: item, enabled });
    else result.update.push({ id: prior.id, detected: item, enabled });
  }

  return result;
}
