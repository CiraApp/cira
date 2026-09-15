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
 * What invoking this actually does, graded by what it would cost to be wrong.
 *
 * `read` returns information. `write` changes something an employee could
 * undo. `destructive` removes or moves something that cannot simply be put
 * back. The grade decides publication (see `publicationFor`), so it is the
 * one judgement the analyzer must be conservative about.
 */
export type CapabilityRisk = "read" | "write" | "destructive";

/**
 * Where the capability lives in the app.
 *
 * Only HTTP for V0, and only a method and a path: never a full URL. The host
 * is resolved at invocation time from the app's own deployment, which is what
 * makes it impossible for a target to point anywhere but the app it belongs to.
 */
export interface CapabilityTarget {
  type: "http";
  method: "GET" | "POST";
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
  /** The analyzer's own confidence, 0 to 1. */
  confidence: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Whether a freshly detected capability may be used without anyone looking at
 * it first.
 *
 * Reading is recoverable and writing is not, so the two are treated
 * differently by default rather than by configuration. A confident read-only
 * capability is the only thing that turns itself on; everything else is
 * registered, visible, and switched off until a person decides otherwise.
 *
 * Deliberately a pure function of the two facts analysis produces, so the
 * policy can be read in one place and tested without a database.
 */
export function publicationFor(args: { risk: CapabilityRisk; confidence: number }): {
  enabled: boolean;
  reason: "auto" | "review" | "destructive";
} {
  if (args.risk === "destructive") return { enabled: false, reason: "destructive" };
  if (args.risk === "write") return { enabled: false, reason: "review" };
  if (args.confidence >= AUTO_ENABLE_CONFIDENCE) {
    return { enabled: true, reason: "auto" };
  }
  return { enabled: false, reason: "review" };
}

/**
 * How sure the analyzer has to be before a read-only capability is live
 * without review. High enough that a guess does not qualify, low enough that
 * the common case does not need a human.
 */
export const AUTO_ENABLE_CONFIDENCE = 0.75;

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
export function reconcileCapabilities<
  T extends { name: string; risk: CapabilityRisk; confidence: number },
>(
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
      prior === undefined
        ? publicationFor({ risk: item.risk, confidence: item.confidence }).enabled
        : prior.enabled;

    if (enabled) result.enabledCount += 1;
    else result.reviewCount += 1;

    if (prior === undefined) result.create.push({ detected: item, enabled });
    else result.update.push({ id: prior.id, detected: item, enabled });
  }

  return result;
}
