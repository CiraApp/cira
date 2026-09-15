/**
 * Company email domains.
 *
 * A company's space is joinable by anyone holding a verified address at its
 * domain, the way a Slack workspace is: if you have the company's email, you
 * work there. That makes the domain a claim about a company, so a domain
 * anyone can sign up at cannot be claimed by one.
 */

/**
 * Providers where an address proves nothing about an employer. Not exhaustive
 * and never will be; it is a floor, not a wall, and the consequence of a gap
 * is one over-eager join offer that still needs a click.
 */
const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.net",
  "zoho.com",
  "yandex.com",
  "mail.com",
  "fastmail.com",
  "hey.com",
  "tutanota.com",
  "duck.com",
  "example.com",
]);

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;

  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  // A bare label with no dot is not a routable company domain.
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) {
    return null;
  }
  return domain;
}

export function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.has(domain.trim().toLowerCase());
}

/**
 * The domain a space should claim from the person creating it, or null when
 * nothing about their address identifies a company.
 */
export function claimableDomain(email: string): string | null {
  const domain = emailDomain(email);
  if (domain === null) return null;
  return isPublicEmailDomain(domain) ? null : domain;
}
