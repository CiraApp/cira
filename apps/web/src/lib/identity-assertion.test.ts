import { describe, expect, it } from "vitest";
import { createVerify, generateKeyPairSync, createPublicKey } from "node:crypto";
import {
  assertIdentity,
  assertionsConfigured,
  ASSERTION_SECONDS,
  ISSUER,
  publicJwks,
} from "./identity-assertion";

/**
 * What Cira tells an app about the person calling, and whether an app can
 * check it. A forged header has to fail here, because an app is reachable
 * through the browser proxy too, where the person sets their own headers.
 */

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const env = {
  CIRA_IDENTITY_KEY: Buffer.from(pem, "utf8").toString("base64"),
  CIRA_IDENTITY_KEY_ID: "k1",
};

const person = { id: "usr_1", name: "Sam Reed", email: "sam@acme.test" };
const subject = {
  user: person,
  spaceSlug: "acme",
  audience: "https://acme-reports.a.run.app",
  via: "ask" as const,
};
const now = new Date("2026-09-20T12:00:00Z");

/** Read a JWT the way an app's library would, signature included. */
function read(token: string, key = createPublicKey(privateKey)) {
  const [head, body, signature] = token.split(".");
  const verifier = createVerify("sha256");
  verifier.update(`${head}.${body}`);
  const valid = verifier.verify(
    { key, dsaEncoding: "ieee-p1363" },
    Buffer.from(signature ?? "", "base64url"),
  );
  return {
    valid,
    header: JSON.parse(Buffer.from(head ?? "", "base64url").toString()) as Record<
      string,
      unknown
    >,
    claims: JSON.parse(Buffer.from(body ?? "", "base64url").toString()) as Record<
      string,
      unknown
    >,
  };
}

describe("assertIdentity", () => {
  it("says who is calling, for one app, for one minute", () => {
    const token = assertIdentity(subject, now, env);
    expect(token).not.toBeNull();
    const { valid, header, claims } = read(token as string);

    expect(valid).toBe(true);
    expect(header).toMatchObject({ alg: "ES256", typ: "JWT", kid: "k1" });
    expect(claims).toMatchObject({
      iss: ISSUER,
      aud: "https://acme-reports.a.run.app",
      sub: "usr_1",
      email: "sam@acme.test",
      email_verified: true,
      name: "Sam Reed",
      space: "acme",
      via: "ask",
    });
    expect(claims["exp"]).toBe((claims["iat"] as number) + ASSERTION_SECONDS);
    expect(claims["exp"]).toBe(Math.floor(now.getTime() / 1000) + 60);
  });

  it("carries nothing a person could be signed in with", () => {
    const token = assertIdentity(subject, now, env) as string;
    // No token of theirs, no session, nothing an app could replay elsewhere.
    expect(Object.keys(read(token).claims).sort()).toEqual([
      "aud",
      "email",
      "email_verified",
      "exp",
      "iat",
      "iss",
      "name",
      "space",
      "sub",
      "via",
    ]);
  });

  it("cannot be forged by changing what it says", () => {
    const token = assertIdentity(subject, now, env) as string;
    const [head, , signature] = token.split(".");
    const asSomeoneElse = Buffer.from(
      JSON.stringify({ iss: ISSUER, sub: "usr_2", email: "boss@acme.test" }),
    ).toString("base64url");
    expect(read(`${head}.${asSomeoneElse}.${signature}`).valid).toBe(false);

    // And a different key does not verify either.
    const other = generateKeyPairSync("ec", { namedCurve: "P-256" });
    expect(read(token, other.publicKey).valid).toBe(false);
  });

  it("sends nothing at all when Cira has no key", () => {
    expect(assertIdentity(subject, now, {})).toBeNull();
    expect(assertionsConfigured({})).toBe(false);
    expect(assertionsConfigured(env)).toBe(true);
  });

  it("publishes the current key, and the one before it through a rotation", () => {
    const older = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const olderPem = older.privateKey.export({ format: "pem", type: "pkcs8" }).toString();

    expect(publicJwks(env).keys).toEqual([
      expect.objectContaining({ kty: "EC", crv: "P-256", kid: "k1", alg: "ES256" }),
    ]);
    const both = publicJwks({
      ...env,
      CIRA_IDENTITY_KEY_PREVIOUS: Buffer.from(olderPem).toString("base64"),
      CIRA_IDENTITY_KEY_PREVIOUS_ID: "k0",
    });
    expect(both.keys.map((k) => k["kid"])).toEqual(["k1", "k0"]);
    // Public halves only: a published private key would be the whole game.
    expect(JSON.stringify(both)).not.toContain('"d"');
    expect(publicJwks({}).keys).toEqual([]);
  });
});
