/**
 * The token that says a person may open one app.
 *
 * Cira decides; the proxy in front of the apps only checks. This is what
 * carries that decision between them, and it is deliberately the smallest
 * thing that can: who, which app, and until when.
 *
 * Signed rather than looked up, because the alternative is asking Cira about
 * every image, stylesheet and font a page pulls in. The cost of that choice is
 * that revoking someone's access does not take effect until the token expires,
 * so `SESSION_SECONDS` is the honest answer to "how long can a removed
 * employee keep using an app" and is short for that reason.
 *
 * WebCrypto rather than `node:crypto`, so the same code runs in Cira and in
 * the proxy. Two implementations of one signature check is two chances to
 * disagree, and the one that disagrees by accepting is the bad one.
 */

export interface ProxySession {
  userId: string;
  appId: string;
  /** The app this was issued for. A token for one app opens no other. */
  label: string;
  /** Unix seconds. */
  expiresAt: number;
}

/**
 * Fifteen minutes. The proxy renews silently on the next navigation, so nobody
 * sees it; what it bounds is how long a revoked person keeps their access.
 */
export const SESSION_SECONDS = 15 * 60;

export class ProxySessionError extends Error {}

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Over a plain ArrayBuffer, never a shared one, which is what Web Crypto
// accepts; the type says so, since a bare Uint8Array no longer implies it.
function decode(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

// The return type is inferred rather than named: `CryptoKey` is a DOM
// global, and this package does not pull the DOM in for one annotation.
async function key(secret: string) {
  if (secret.length < 32) {
    throw new ProxySessionError("The proxy signing secret is too short.");
  }
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signSession(
  session: ProxySession,
  secret: string,
): Promise<string> {
  const body = encode(new TextEncoder().encode(JSON.stringify(session)));
  const mac = await crypto.subtle.sign(
    "HMAC",
    await key(secret),
    new TextEncoder().encode(body),
  );
  return `${body}.${encode(new Uint8Array(mac))}`;
}

/**
 * Null for anything not currently valid, with no reason attached.
 *
 * One answer for a forged signature, a token for a different app and an
 * expired one, because the caller does the same thing in every case and a
 * caller that told them apart would be telling whoever sent it apart too.
 */
export async function verifySession(
  token: string,
  secret: string,
  expected: { label: string; now?: number },
): Promise<ProxySession | null> {
  const [body, mac] = token.split(".");
  if (body === undefined || mac === undefined) return null;

  let valid: boolean;
  try {
    // Constant-time, and done by the platform rather than by a comparison
    // somebody has to remember not to write with `===`.
    valid = await crypto.subtle.verify(
      "HMAC",
      await key(secret),
      decode(mac),
      new TextEncoder().encode(body),
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  let session: ProxySession;
  try {
    session = JSON.parse(new TextDecoder().decode(decode(body))) as ProxySession;
  } catch {
    return null;
  }

  if (
    typeof session.userId !== "string" ||
    typeof session.appId !== "string" ||
    typeof session.label !== "string" ||
    typeof session.expiresAt !== "number"
  ) {
    return null;
  }

  // Bound to the app it was issued for, so a token taken from one app is not a
  // way into another the same person cannot open.
  if (session.label !== expected.label) return null;

  const now = expected.now ?? Math.floor(Date.now() / 1000);
  if (session.expiresAt <= now) return null;

  return session;
}
