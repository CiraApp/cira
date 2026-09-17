/**
 * Where an app's front door really is, when Cira is not the one serving it.
 *
 * Plenty of internal software was running somewhere long before Cira existed,
 * and plenty more is a frontend whose backend is the only half worth deploying
 * here. The shelf is a directory of what a company runs, not a list of what
 * this platform happens to host, so an app may carry an address Cira does not
 * own and open there instead.
 *
 * It is deliberately just a link. Cira does not proxy it, does not know who is
 * signed in on the other side, and makes no claim that it is up - so nothing
 * here needs to be trusted beyond being a URL a browser can follow.
 */

/** Longer than any address a person types, short enough to bound the column. */
export const MAX_HOMEPAGE_URL = 2048;

/**
 * The address to store, or null when the text is not one Cira will link to.
 *
 * Returns the parsed form rather than the raw text so that what is stored is
 * what a browser would resolve - `example.com` typed without a scheme is not
 * quietly accepted as something it is not.
 */
export function normalizeHomepageUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > MAX_HOMEPAGE_URL) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  // A private address is a perfectly ordinary answer here - a great deal of
  // internal software lives on one - because this is a link a person clicks,
  // not a request a server makes. The scheme is the part that matters: an
  // `href` is one of the few places `javascript:` still executes, and this
  // value is typed by one person and rendered for everyone in the space.
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.hostname === "") return null;

  return url.toString();
}
