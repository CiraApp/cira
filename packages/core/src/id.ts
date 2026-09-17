/**
 * Prefixed identifiers.
 *
 * Ids carry their type so a mis-wired query is obvious in a log line or a URL
 * rather than being an opaque uuid that could have come from anywhere.
 */

export const ID_PREFIXES = {
  user: "usr",
  space: "spc",
  membership: "mem",
  team: "tem",
  teamMember: "tmm",
  app: "app",
  appSlug: "aps",
  access: "acc",
  deployment: "dep",
  service: "svc",
  invite: "inv",
  capability: "cap",
  /** An uploaded source archive. Not a row: it names an object in a bucket. */
  source: "src",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

export function newId(kind: IdKind): string {
  return `${ID_PREFIXES[kind]}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function isId(kind: IdKind, value: string): boolean {
  return value.startsWith(`${ID_PREFIXES[kind]}_`);
}

/**
 * URL-safe slug. Used for space and app slugs, which together form the public
 * path `/{spaceSlug}/{appSlug}`.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/**
 * Is this a slug `slugify` could have produced?
 *
 * Used to reject paths that cannot name a space or app before they reach the
 * database or the session. Without it, requests for files that do not exist
 * (`/favicon.ico`, `/robots.txt`) match the dynamic space route and fail as
 * server errors instead of honest 404s.
 */
export function isSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 48;
}

/**
 * An unguessable invite token.
 *
 * 256 bits from the platform CSPRNG. It is the only thing standing between a
 * link and membership of a company's space, so it is never derived from an id,
 * an email, or a timestamp.
 */
export function newInviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Does this look like a token we issued? Cheap reject before any lookup. */
export function isInviteToken(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}
