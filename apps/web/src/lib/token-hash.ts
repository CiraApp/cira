import { createHash, timingSafeEqual } from "node:crypto";

/**
 * How Cira keeps a secret it hands out: as a SHA-256 hash, never as itself.
 *
 * CLI tokens, invite links and the device code a `cira login` polls with are
 * all random values Cira shows once and later only needs to recognise. Keeping
 * the hash is enough to recognise one, and it means a copy of the database
 * yields no working link, login or token. No salt is needed: each value is 32
 * random bytes, so there is nothing a table of precomputed hashes could hold.
 */

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Compare two hashes without leaking, through timing, how much of a guess was
 * correct. Lengths are compared first because timingSafeEqual throws on a
 * mismatch, and length alone is not a secret.
 */
export function hashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}
