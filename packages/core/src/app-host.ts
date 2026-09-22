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
}

/**
 * The label for an app, or null when its slugs cannot make a legal one.
 *
 * Null rather than a truncation, because a truncated address would have to be
 * resolved by storing it somewhere, and an address that cannot be worked out
 * from the app it belongs to is an address that can drift from it.
 */
export function appLabel(address: AppAddress): string | null {
  const { appSlug, spaceSlug } = address;
  if (!SLUG.test(appSlug) || !SLUG.test(spaceSlug)) return null;

  const label = `${appSlug}${SEPARATOR}${spaceSlug}`;
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
 * Split on the first separator, because an app slug cannot contain one and a
 * space slug cannot either - so a second occurrence means the hostname was not
 * one of ours, and saying no is better than guessing which half is which.
 */
export function parseAppLabel(label: string): AppAddress | null {
  const lower = label.toLowerCase();
  const parts = lower.split(SEPARATOR);
  if (parts.length !== 2) return null;

  const [appSlug, spaceSlug] = parts;
  if (appSlug === undefined || spaceSlug === undefined) return null;
  if (!SLUG.test(appSlug) || !SLUG.test(spaceSlug)) return null;

  return { appSlug, spaceSlug };
}

/** The same, from a full hostname under the apps domain. */
export function parseAppHost(host: string, appsDomain: string): AppAddress | null {
  const bare = host.toLowerCase().split(":")[0] ?? "";
  const suffix = `.${appsDomain.toLowerCase()}`;
  if (!bare.endsWith(suffix)) return null;
  return parseAppLabel(bare.slice(0, -suffix.length));
}

/**
 * A company's own hostname for an app - `tools.acme.com` - lowercased, or why
 * it cannot be one.
 *
 * A subdomain, because the way in is a CNAME record and most DNS hosts will
 * not put one at the root of a domain. Never under Cira's own domain, whose
 * names are Cira's to give out, and never an address: a certificate is for a
 * name.
 */
export function customHostname(
  input: string,
  appsDomain: string,
): { ok: true; hostname: string } | { ok: false; reason: string } {
  const hostname = input.trim().toLowerCase().replace(/\.$/, "");
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(hostname) || hostname.includes("/")) {
    return {
      ok: false,
      reason: "Just the name, like tools.acme.com, with no https:// or path.",
    };
  }
  const labels = hostname.split(".");
  const valid =
    hostname.length <= 253 &&
    labels.length >= 2 &&
    labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) &&
    !/^\d+$/.test(labels.at(-1) ?? "");
  if (!valid) return { ok: false, reason: "That is not a name a domain can have." };
  const own = appsDomain.toLowerCase();
  if (hostname === own || hostname.endsWith(`.${own}`)) {
    return { ok: false, reason: `Names under ${own} are Cira's own.` };
  }
  if (labels.length === 2) {
    return {
      ok: false,
      reason: `Use a name under your domain, like tools.${hostname}: its root cannot point at Cira.`,
    };
  }
  return { ok: true, hostname };
}
