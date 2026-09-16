import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildAssertion, readServiceAccount } from "./auth";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const account = { clientEmail: "cira@p.iam.gserviceaccount.com", privateKey };

function decode(jwt: string, part: 0 | 1): Record<string, unknown> {
  const segment = jwt.split(".")[part] ?? "";
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
}

describe("readServiceAccount", () => {
  it("reads a well formed key", () => {
    const read = readServiceAccount(
      JSON.stringify({ client_email: "a@b.com", private_key: "KEY" }),
    );
    expect(read).toEqual({ clientEmail: "a@b.com", privateKey: "KEY" });
  });

  it("unescapes newlines an environment variable mangled", () => {
    // Keys pasted into an env var routinely arrive with literal \n, which
    // fails signing with an error that mentions neither newlines nor the key.
    const read = readServiceAccount(
      JSON.stringify({
        client_email: "a@b.com",
        private_key: "-----BEGIN-----\\nmid\\n-----END-----",
      }),
    );
    expect(read.privateKey).toBe("-----BEGIN-----\nmid\n-----END-----");
  });

  it("refuses a malformed credential loudly", () => {
    // A misconfiguration should stop the deploy, not degrade into an
    // unexplained 401 from Google later.
    expect(() => readServiceAccount("not json")).toThrow(/valid JSON/);
    expect(() => readServiceAccount(JSON.stringify({ client_email: "a@b.com" }))).toThrow(
      /client_email or private_key/,
    );
  });
});

describe("buildAssertion", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  it("is a signed RS256 JWT", () => {
    const jwt = buildAssertion(account, { scope: "s" }, now);
    expect(jwt.split(".")).toHaveLength(3);
    expect(decode(jwt, 0)).toEqual({ alg: "RS256", typ: "JWT" });
  });

  it("is issued by the service account, to Google's token endpoint", () => {
    const claims = decode(buildAssertion(account, { scope: "s" }, now), 1);
    expect(claims["iss"]).toBe(account.clientEmail);
    expect(claims["aud"]).toBe("https://oauth2.googleapis.com/token");
  });

  it("expires within Google's maximum", () => {
    const claims = decode(buildAssertion(account, { scope: "s" }, now), 1);
    expect(Number(claims["exp"]) - Number(claims["iat"])).toBeLessThanOrEqual(3600);
  });

  it("asks for an access token or an identity token, never both", () => {
    // Google treats the two as different requests and quietly returns the
    // wrong kind of token when both appear.
    const forApis = decode(buildAssertion(account, { scope: "cloud" }, now), 1);
    expect(forApis["scope"]).toBe("cloud");
    expect(forApis["targetAudience"]).toBeUndefined();

    const forApp = decode(
      buildAssertion(account, { targetAudience: "https://app.run.app" }, now),
      1,
    );
    expect(forApp["targetAudience"]).toBe("https://app.run.app");
    expect(forApp["scope"]).toBeUndefined();
  });

  it("addresses one app, so a token for one is useless against another", () => {
    // This is what makes an app unreachable except through Cira: Cloud Run
    // checks the audience and refuses a token minted for anything else.
    const a = decode(
      buildAssertion(account, { targetAudience: "https://a.run.app" }, now),
      1,
    );
    const b = decode(
      buildAssertion(account, { targetAudience: "https://b.run.app" }, now),
      1,
    );
    expect(a["targetAudience"]).not.toBe(b["targetAudience"]);
  });

  it("uses base64url, so the token survives a header", () => {
    expect(buildAssertion(account, { scope: "s" }, now)).not.toMatch(/[+/=]/);
  });
});
