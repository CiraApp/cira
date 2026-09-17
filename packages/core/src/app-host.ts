/**
 * The address a deployed app answers on.
 *
 * `{app}--{space}.cira.dev`, and the double hyphen is the whole trick. Slugs
 * collapse every run of non-alphanumerics to a single hyphen, so no slug can
 * contain `--`; that makes it a separator nothing else can produce, which is
 * what keeps `acme-corp` + `ledger` distinct from `acme` + `corp-ledger`. The
 * same ambiguity in Cloud Run service names let two companies land on one
 * service, so it is worth being careful about twice.
 *
 * One DNS label rather than two, which is not an aesthetic choice. A wildcard
 * certificate matches exactly one label: `*.cira.dev` covers
 * `ledger--acme.cira.dev` and not `ledger.acme.cira.dev`. The first is free,
 * the second needs a paid certificate product.
 *
 * It buys something the prettier form would have needed a separate mechanism
 * for, too. Every app address contains `--` and no ordinary hostname does, so
 * `www`, `api`, `docs` and `status` can never be claimed by naming an app
 * badly. The namespaces do not overlap, by construction rather than by a list
 * somebody has to remember to maintain.
 */

/** A DNS label cannot exceed this, and the whole address is one label. */
export const MAX_LABEL = 63;

const SEPARATOR = "--";

/** Each half, so that any pair fits inside one label with room for the join. */
export const MAX_HOST_SLUG = Math.floor((MAX_LABEL - SEPARATOR.length) / 2);

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface AppAddress {
  appSlug: string;
  spaceSlug: string;
  /**
   * One service inside the app, when the address names a part rather than the
   * whole: `api--wave--paradym`. Absent for the app's own front door, which is
   * what almost every address is.
   *
   * A third part costs nothing that the second did not already cost. It is
   * still one DNS label, so the free wildcard certificate still covers it, and
   * `--` still cannot occur inside a slug - so two parts and three parts are
   * told apart by counting, with no ambiguity to resolve and no list of
   * reserved names to maintain.
   *
   * Most apps will never need one. An app whose halves talk over paths on a
   * single origin is better off that way: one address, one cookie, no CORS.
   * This exists for the app that cannot be arranged like that - a backend
   * serving at the root, or a frontend written to call an absolute origin -
   * so that supporting it later never has to change an address already in
   * somebody's browser history.
   */
  serviceSlug?: string;
}

/**
 * The label for an app, or null when its slugs cannot make a legal one.
 *
 * Null rather than a truncation, because a truncated address would have to be
 * resolved by storing it somewhere, and an address that cannot be worked out
 * from the app it belongs to is an address that can drift from it.
 */
export function appLabel(address: AppAddress): string | null {
  const { appSlug, spaceSlug, serviceSlug } = address;

  const parts =
    serviceSlug === undefined ? [appSlug, spaceSlug] : [serviceSlug, appSlug, spaceSlug];
  if (!parts.every((part) => SLUG.test(part))) return null;

  const label = parts.join(SEPARATOR);
  return label.length > MAX_LABEL ? null : label;
}

/** The full hostname, given the domain apps are served under. */
export function appHost(address: AppAddress, appsDomain: string): string | null {
  const label = appLabel(address);
  return label === null ? null : `${label}.${appsDomain}`;
}

/**
 * Read an address back out of a hostname.
 *
 * Counting the parts is the whole of it, because no slug can contain the
 * separator: two means the app itself, three means one service inside it, and
 * anything else was never one of ours. Saying no is better than guessing which
 * piece is which.
 */
export function parseAppLabel(label: string): AppAddress | null {
  const parts = label.toLowerCase().split(SEPARATOR);
  if (parts.length < 2 || parts.length > 3) return null;
  if (!parts.every((part) => SLUG.test(part))) return null;

  if (parts.length === 2) {
    const [appSlug, spaceSlug] = parts as [string, string];
    return { appSlug, spaceSlug };
  }

  const [serviceSlug, appSlug, spaceSlug] = parts as [string, string, string];
  return { serviceSlug, appSlug, spaceSlug };
}

/** The same, from a full hostname under the apps domain. */
export function parseAppHost(host: string, appsDomain: string): AppAddress | null {
  const bare = host.toLowerCase().split(":")[0] ?? "";
  const suffix = `.${appsDomain.toLowerCase()}`;
  if (!bare.endsWith(suffix)) return null;
  return parseAppLabel(bare.slice(0, -suffix.length));
}
