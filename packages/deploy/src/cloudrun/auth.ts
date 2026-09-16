import { createSign } from "node:crypto";

/**
 * Talking to Google as Cira, and to a Cira app as Cira.
 *
 * Two different credentials for two different jobs, which is the part worth
 * keeping straight:
 *
 * - An **access token** authorises Cira against Google's own APIs - Cloud
 *   Build, Cloud Run, Storage. It says "this service account may deploy".
 * - An **identity token** authorises Cira against a deployed app. Cloud Run
 *   checks it and refuses everyone else, which is what makes an app
 *   unreachable except through Cira.
 *
 * The second is the direct analogue of Vercel's protection-bypass secret, and
 * it is better in one specific way: it is minted per request and expires, so
 * there is no long-lived shared value sitting in a database column the way
 * `apps.access_secret` does today.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";

/** The half of a service account key this needs. Never logged, never stored. */
export interface ServiceAccount {
  clientEmail: string;
  privateKey: string;
}

interface Cached {
  token: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

/**
 * Parse a service account key JSON.
 *
 * Thrown rather than returned as null: a malformed credential is a
 * misconfiguration that should stop a deploy loudly, not degrade into an
 * unexplained 401 from Google an hour later.
 */
export function readServiceAccount(json: string): ServiceAccount {
  let parsed: { client_email?: unknown; private_key?: unknown };
  try {
    parsed = JSON.parse(json) as typeof parsed;
  } catch {
    throw new Error("The Google service account key is not valid JSON.");
  }

  const clientEmail = parsed.client_email;
  const privateKey = parsed.private_key;
  if (typeof clientEmail !== "string" || typeof privateKey !== "string") {
    throw new Error(
      "The Google service account key is missing client_email or private_key.",
    );
  }

  // Keys pasted through an environment variable routinely arrive with their
  // newlines escaped, which fails signing with an error that names neither.
  return { clientEmail, privateKey: privateKey.replace(/\\n/g, "\n") };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * A signed assertion that this service account is who it says it is.
 *
 * `scope` asks for access to Google's APIs; `targetAudience` asks instead for
 * an identity token addressed to one app. Exactly one of them is set, because
 * Google treats the two as different requests and quietly returns the wrong
 * kind of token if both appear.
 */
export function buildAssertion(
  account: ServiceAccount,
  claim: { scope: string } | { targetAudience: string },
  now: Date = new Date(),
): string {
  const issued = Math.floor(now.getTime() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: account.clientEmail,
    aud: TOKEN_URL,
    iat: issued,
    // An hour is Google's maximum; a shorter life would mean re-signing more
    // often for no benefit, since the assertion never leaves this process.
    exp: issued + 3600,
    ...claim,
  };

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(account.privateKey);
  return `${unsigned}.${base64url(signature)}`;
}

/**
 * Tokens, fetched on demand and reused until they are nearly out.
 *
 * Cached per audience: an access token for Google and an identity token for
 * each app are different values with different lifetimes, and sharing one slot
 * between them would hand an app a token meant for Cloud Build.
 */
export class GoogleTokens {
  private readonly cache = new Map<string, Cached>();

  constructor(private readonly account: ServiceAccount) {}

  /** For Google's own APIs. */
  async accessToken(
    scope = "https://www.googleapis.com/auth/cloud-platform",
  ): Promise<string> {
    return this.fetchToken(`scope:${scope}`, { scope }, "access_token");
  }

  /**
   * For one deployed app. The audience is the service's own URL, so a token
   * minted for one app is rejected by every other.
   */
  async identityToken(serviceUrl: string): Promise<string> {
    return this.fetchToken(
      `aud:${serviceUrl}`,
      { targetAudience: serviceUrl },
      "id_token",
    );
  }

  private async fetchToken(
    key: string,
    claim: { scope: string } | { targetAudience: string },
    field: "access_token" | "id_token",
  ): Promise<string> {
    const held = this.cache.get(key);
    // Sixty seconds of headroom: a token that expires in flight fails the
    // request it was fetched for.
    if (held !== undefined && held.expiresAt > Date.now() + 60_000) return held.token;

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: GRANT,
        assertion: buildAssertion(this.account, claim),
      }),
    });

    if (!response.ok) {
      // Google's body can echo the assertion, so it is not passed through.
      throw new Error(`Google refused the service account (${response.status}).`);
    }

    const body = (await response.json()) as Record<string, unknown>;
    const token = body[field];
    if (typeof token !== "string") {
      throw new Error("Google returned no usable token.");
    }

    const lifetime = typeof body["expires_in"] === "number" ? body["expires_in"] : 3600;
    this.cache.set(key, { token, expiresAt: Date.now() + lifetime * 1000 });
    return token;
  }
}
