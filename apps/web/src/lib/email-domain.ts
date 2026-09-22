/**
 * Company email domains.
 *
 * A company's space is joinable by anyone holding a verified address at its
 * domain, the way a Slack workspace is: if you have the company's email, you
 * work there. That makes the domain a claim about a company, so a domain
 * anyone can sign up at cannot be claimed by one.
 */

/**
 * Providers where an address proves nothing about an employer.
 *
 * Joining by domain is now something an admin switches on, so a gap here no
 * longer opens a company to strangers by itself. It still decides whether a
 * space may claim a domain at all, and a space founded from a personal
 * address must not be offered to everyone else at that provider - which is
 * what happened with every provider this list did not know. So it covers the
 * providers people actually use around the world, their country variants,
 * and the large ISPs that hand out addresses with a connection.
 */
const PUBLIC_EMAIL_DOMAINS = new Set([
  // Google, Microsoft, Apple, Yahoo, AOL, and their country variants.
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "outlook.co.uk",
  "outlook.de",
  "outlook.fr",
  "outlook.es",
  "outlook.it",
  "outlook.jp",
  "outlook.com.au",
  "outlook.com.br",
  "hotmail.com",
  "hotmail.co.uk",
  "hotmail.de",
  "hotmail.fr",
  "hotmail.es",
  "hotmail.it",
  "hotmail.nl",
  "hotmail.ca",
  "hotmail.com.au",
  "hotmail.com.br",
  "live.com",
  "live.co.uk",
  "live.de",
  "live.fr",
  "live.nl",
  "live.ca",
  "live.com.au",
  "msn.com",
  "passport.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.de",
  "yahoo.fr",
  "yahoo.es",
  "yahoo.it",
  "yahoo.ca",
  "yahoo.co.in",
  "yahoo.co.jp",
  "yahoo.com.au",
  "yahoo.com.br",
  "yahoo.com.mx",
  "ymail.com",
  "rocketmail.com",
  "aol.com",
  "aim.com",
  // Privacy and independent providers.
  "proton.me",
  "protonmail.com",
  "protonmail.ch",
  "pm.me",
  "tutanota.com",
  "tutanota.de",
  "tuta.io",
  "tutamail.com",
  "fastmail.com",
  "fastmail.fm",
  "hey.com",
  "duck.com",
  "mailbox.org",
  "posteo.de",
  "posteo.net",
  "runbox.com",
  "zoho.com",
  "zohomail.com",
  "mail.com",
  "email.com",
  "usa.com",
  "inbox.com",
  "hushmail.com",
  "skiff.com",
  // Europe.
  "gmx.com",
  "gmx.net",
  "gmx.de",
  "gmx.at",
  "gmx.ch",
  "web.de",
  "freenet.de",
  "t-online.de",
  "arcor.de",
  "orange.fr",
  "wanadoo.fr",
  "free.fr",
  "sfr.fr",
  "laposte.net",
  "libero.it",
  "virgilio.it",
  "tiscali.it",
  "alice.it",
  "seznam.cz",
  "wp.pl",
  "o2.pl",
  "onet.pl",
  "interia.pl",
  "btinternet.com",
  "virginmedia.com",
  "sky.com",
  "talktalk.net",
  "blueyonder.co.uk",
  "ntlworld.com",
  "telenet.be",
  "ziggo.nl",
  "kpnmail.nl",
  "bluewin.ch",
  "yandex.com",
  "yandex.ru",
  "ya.ru",
  "mail.ru",
  "bk.ru",
  "inbox.ru",
  "list.ru",
  "rambler.ru",
  "ukr.net",
  // Asia and elsewhere.
  "qq.com",
  "foxmail.com",
  "163.com",
  "126.com",
  "yeah.net",
  "sina.com",
  "sina.cn",
  "sohu.com",
  "aliyun.com",
  "naver.com",
  "daum.net",
  "hanmail.net",
  "nate.com",
  "rediffmail.com",
  "uol.com.br",
  "bol.com.br",
  "terra.com.br",
  "ig.com.br",
  "bigpond.com",
  "optusnet.com.au",
  // North American ISPs.
  "comcast.net",
  "verizon.net",
  "att.net",
  "sbcglobal.net",
  "bellsouth.net",
  "cox.net",
  "charter.net",
  "earthlink.net",
  "juno.com",
  "shaw.ca",
  "rogers.com",
  "sympatico.ca",
  "videotron.ca",
  // Never a real company.
  "example.com",
  "example.org",
  "example.net",
  "test.com",
  "mailinator.com",
]);

/**
 * Addresses a university gives to everyone who studies or works there. A
 * student's address is not a claim on a company, whatever the domain.
 */
const ACADEMIC = /(^|\.)(edu|ac\.[a-z]{2}|edu\.[a-z]{2})$/;

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
  const d = domain.trim().toLowerCase();
  return PUBLIC_EMAIL_DOMAINS.has(d) || ACADEMIC.test(d);
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
