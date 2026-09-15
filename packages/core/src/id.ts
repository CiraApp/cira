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
  app: "app",
  access: "acc",
  deployment: "dep",
  invite: "inv",
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
