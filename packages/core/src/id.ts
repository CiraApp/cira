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
  /** One question put to Ask Cira: what it cost, never what was said. */
  askUsage: "ask",
  /** One capability run: who, what, from where, never with what. */
  invocation: "run",
  /** A worker or scheduled run an app declares. */
  process: "prc",
  /** One event people were emailed about, claimed once so it is sent once. */
  notification: "ntf",
  /** Someone removed from a space, kept so joining by domain cannot undo it. */
  joinBlock: "jbl",
  /** A CLI's long-lived credential, kept as a hash. */
  cliToken: "tok",
  /** One `cira login` in progress. */
  cliLogin: "lgn",
  /** An uploaded source archive. Not a row: it names an object in a bucket. */
  source: "src",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

/**
 * What the demo company's rows carry in their ids: `usr_demo_ada`,
 * `app_demo_ledger`. Its people are invented, and their addresses are at a
 * domain someone else may own, so nothing Cira sends may ever reach one.
 */
export const DEMO_MARK = "_demo_";

/** Whether this is one of the demo company's invented people. */
export function isInventedPerson(userId: string): boolean {
  return userId.startsWith(`${ID_PREFIXES.user}${DEMO_MARK}`);
}

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
  // Cut, then trimmed again: cutting a long name mid-word can leave a dash at
  // the end, and a slug ending in one is not a slug - the space it named could
  // be neither opened nor deleted.
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/, "");
}

/** The longest a slug may be. `isSlug` holds everything to it. */
export const SLUG_MAX = 48;

/**
 * `base` with `-suffix` on the end, cut so the whole still fits. `acme-2` from
 * a 48-character base used to be 50 characters, which `isSlug` refuses.
 */
export function slugWithSuffix(base: string, suffix: string): string {
  const room = SLUG_MAX - suffix.length - 1;
  const trimmed = base.slice(0, room).replace(/-+$/, "");
  return trimmed === "" ? suffix : `${trimmed}-${suffix}`;
}

/**
 * Addresses a space can never have, because Cira's own pages are already
 * there: a space called Docs would get `/docs` and never be reachable. Also
 * the obvious ones a future page is likely to want.
 */
export const RESERVED_SPACE_SLUGS: ReadonlySet<string> = new Set([
  "account-conflict",
  "api",
  "cli",
  "demo",
  "docs",
  "enter",
  "invite",
  "legal",
  "onboarding",
  "pricing",
  "sign-in",
  "sign-up",
  "monitoring",
  "about",
  "account",
  "admin",
  "app",
  "apps",
  "assets",
  "auth",
  "billing",
  "blog",
  "changelog",
  "contact",
  "dashboard",
  "download",
  "help",
  "home",
  "login",
  "logout",
  "new",
  "privacy",
  "public",
  "security",
  "settings",
  "signin",
  "signup",
  "static",
  "status",
  "support",
  "terms",
  "well-known",
  "www",
]);

/**
 * Is this a slug `slugify` could have produced?
 *
 * Used to reject paths that cannot name a space or app before they reach the
 * database or the session. Without it, requests for files that do not exist
 * (`/favicon.ico`, `/robots.txt`) match the dynamic space route and fail as
 * server errors instead of honest 404s.
 */
export function isSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= SLUG_MAX;
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
