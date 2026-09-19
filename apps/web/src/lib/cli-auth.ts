import { randomBytes } from "node:crypto";

/**
 * Credentials for the `cira` CLI.
 *
 * A login splits into two secrets. The CLI keeps the device code and polls
 * with it; the person only ever sees the short user code. That way a code
 * read aloud, screenshotted, or pasted into a chat cannot be exchanged for a
 * token by whoever saw it.
 */

/**
 * Crockford base32's alphabet: someone has to read this off one screen and
 * type it into another. I, L, O and 0/1 are dropped because they are misread
 * for each other, and U because excluding it avoids accidental profanity.
 */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

export function newUserCode(): string {
  const pick = (n: number) =>
    Array.from(randomBytes(n), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  return `${pick(4)}-${pick(4)}`;
}

export function newDeviceCode(): string {
  return randomBytes(32).toString("hex");
}

/** The token handed to the CLI. Shown once, then only its hash is kept. */
export function newCliToken(): string {
  return `cira_${randomBytes(32).toString("hex")}`;
}

/** Normalise what someone typed: case, spaces, and a dash they may have dropped. */
export function normaliseUserCode(input: string): string | null {
  const bare = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (bare.length !== 8) return null;
  for (const ch of bare) if (!CODE_ALPHABET.includes(ch)) return null;
  return `${bare.slice(0, 4)}-${bare.slice(4)}`;
}

/** A login attempt lapses quickly; an unattended terminal should not stay armed. */
export const LOGIN_LIFETIME_MS = 10 * 60 * 1000;

export function loginExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + LOGIN_LIFETIME_MS);
}

export type LoginState =
  | { status: "pending" }
  | { status: "approved" }
  | { status: "expired" }
  | { status: "claimed" };

export function loginState(
  request: { approvedAt: Date | null; claimedAt: Date | null; expiresAt: Date },
  now: Date = new Date(),
): LoginState {
  if (request.claimedAt !== null) return { status: "claimed" };
  if (request.approvedAt !== null) return { status: "approved" };
  if (request.expiresAt.getTime() <= now.getTime()) return { status: "expired" };
  return { status: "pending" };
}
