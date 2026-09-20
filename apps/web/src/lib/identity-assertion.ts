import "server-only";

import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import type { User } from "@cira/core";
import type { InvocationVia } from "@/lib/invoke-capability";

/**
 * Telling an app who is calling, in a way the app can check.
 *
 * An app that signs its own users in cannot do anything with a call that says
 * only "Cira is calling", which is why every such capability ends up refused.
 * This is the way out: a statement about the person, signed by Cira, that the
 * app verifies against keys Cira publishes.
 *
 * Signed rather than merely sent, because an app is reachable through Cira's
 * browser proxy as well, where the person at the other end controls their own
 * headers. A signature is what makes the claim worth anything however the
 * request arrived.
 *
 * It says only what Cira already knows - who, which company, and whether an
 * agent is asking - lives for sixty seconds, and names one app as its
 * audience, so it is useless a minute later or anywhere else. Cira holds no
 * new secret of anyone's: this is not a vault (docs/secrets.md).
 */

/** Cira, as an issuer. Matches what an app is told to expect. */
export const ISSUER = "https://cira.dev";

/** Long enough to be used, short enough that a captured one is worthless. */
export const ASSERTION_SECONDS = 60;

export const IDENTITY_HEADER = "x-cira-identity";

export interface AssertionSubject {
  user: Pick<User, "id" | "name" | "email">;
  spaceSlug: string;
  /** The app's own origin, which is what the app checks as its audience. */
  audience: string;
  via: InvocationVia;
}

interface SigningKey {
  id: string;
  pem: string;
}

/**
 * The key Cira signs with, and the one it signed with before.
 *
 * Both are published so an app that cached the old one keeps working through
 * a rotation; only the current one ever signs. Held in the environment, like
 * every other secret, and never in the database.
 */
function keys(env: Record<string, string | undefined> = process.env): {
  current: SigningKey | null;
  previous: SigningKey | null;
} {
  const read = (key: string, id: string): SigningKey | null => {
    const raw = env[key]?.trim();
    const name = env[id]?.trim();
    if (raw === undefined || raw === "" || name === undefined || name === "") return null;
    // Base64 so a PEM survives an environment variable without its newlines
    // being someone else's problem.
    const pem = raw.includes("BEGIN") ? raw : Buffer.from(raw, "base64").toString("utf8");
    return { id: name, pem };
  };
  return {
    current: read("CIRA_IDENTITY_KEY", "CIRA_IDENTITY_KEY_ID"),
    previous: read("CIRA_IDENTITY_KEY_PREVIOUS", "CIRA_IDENTITY_KEY_PREVIOUS_ID"),
  };
}

export function assertionsConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return keys(env).current !== null;
}

/**
 * A signed statement about the person this call is for, or null when Cira has
 * no key - in which case nothing is sent and the app sees what it always saw.
 */
export function assertIdentity(
  subject: AssertionSubject,
  now: Date = new Date(),
  env: Record<string, string | undefined> = process.env,
): string | null {
  const key = keys(env).current;
  if (key === null) return null;

  const issued = Math.floor(now.getTime() / 1000);
  return jwt(
    { alg: "ES256", typ: "JWT", kid: key.id },
    {
      iss: ISSUER,
      aud: subject.audience,
      sub: subject.user.id,
      email: subject.user.email,
      // Cira only ever holds addresses a provider verified; an app matching
      // its own accounts on this needs to know that.
      email_verified: true,
      name: subject.user.name,
      space: subject.spaceSlug,
      // An app may want to treat an agent differently from a person, and only
      // Cira knows which this was.
      via: subject.via,
      iat: issued,
      exp: issued + ASSERTION_SECONDS,
    },
    key.pem,
  );
}

/** The public half of both keys, for an app to verify with. */
export function publicJwks(env: Record<string, string | undefined> = process.env): {
  keys: Array<Record<string, unknown>>;
} {
  const { current, previous } = keys(env);
  return {
    keys: [current, previous].filter((key): key is SigningKey => key !== null).map(jwk),
  };
}

function jwk(key: SigningKey): Record<string, unknown> {
  const exported = createPublicKey(createPrivateKey(key.pem)).export({
    format: "jwk",
  }) as Record<string, unknown>;
  return { ...exported, kid: key.id, use: "sig", alg: "ES256" };
}

function jwt(
  header: Record<string, unknown>,
  claims: Record<string, unknown>,
  pem: string,
): string {
  const signing = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  // JOSE wants the raw r||s pair; Node signs ECDSA as DER unless told
  // otherwise, and a DER signature here verifies nowhere.
  const signature = sign("sha256", Buffer.from(signing), {
    key: createPrivateKey(pem),
    dsaEncoding: "ieee-p1363",
  });
  return `${signing}.${signature.toString("base64url")}`;
}

function base64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}
