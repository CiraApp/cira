import { describe, expect, it } from "vitest";
import {
  ProxySessionError,
  SESSION_SECONDS,
  signSession,
  verifySession,
  type ProxySession,
} from "./proxy-session.js";

const SECRET = "a".repeat(48);
const OTHER = "b".repeat(48);

const now = 1_800_000_000;
const session: ProxySession = {
  userId: "usr_1",
  appId: "app_1",
  label: "ledger--acme",
  expiresAt: now + SESSION_SECONDS,
};

describe("signSession / verifySession", () => {
  it("round-trips a session", async () => {
    const token = await signSession(session, SECRET);
    expect(await verifySession(token, SECRET, { label: "ledger--acme", now })).toEqual(
      session,
    );
  });

  it("refuses a token signed with another secret", async () => {
    const token = await signSession(session, OTHER);
    expect(await verifySession(token, SECRET, { label: "ledger--acme", now })).toBeNull();
  });

  /**
   * The one that matters most. Every app gets its own hostname and its own
   * cookie, but a cookie can be moved by hand - so the token says which app it
   * was issued for and is refused anywhere else.
   */
  it("refuses a token issued for a different app", async () => {
    const token = await signSession(session, SECRET);
    expect(
      await verifySession(token, SECRET, { label: "payroll--acme", now }),
    ).toBeNull();
  });

  it("refuses an expired token", async () => {
    const token = await signSession(session, SECRET);
    const after = session.expiresAt + 1;
    expect(
      await verifySession(token, SECRET, { label: "ledger--acme", now: after }),
    ).toBeNull();
  });

  it("refuses a token whose payload was edited", async () => {
    const token = await signSession(session, SECRET);
    const [body, mac] = token.split(".");
    const tampered = JSON.stringify({ ...session, userId: "usr_someone_else" });
    const swapped = `${btoa(tampered).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.${mac}`;
    expect(body).not.toBe("");
    expect(
      await verifySession(swapped, SECRET, { label: "ledger--acme", now }),
    ).toBeNull();
  });

  it("refuses malformed input rather than throwing at the caller", async () => {
    for (const bad of ["", ".", "nope", "a.b.c", "!!!.???"]) {
      expect(await verifySession(bad, SECRET, { label: "ledger--acme", now })).toBeNull();
    }
  });

  // A short secret is a configuration mistake, and failing loudly at the point
  // of use beats signing something with it.
  it("refuses to sign with a secret that is too short", async () => {
    await expect(signSession(session, "short")).rejects.toThrow(ProxySessionError);
  });
});
