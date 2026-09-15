import { describe, expect, it } from "vitest";
import {
  hashToken,
  hashesMatch,
  loginExpiry,
  loginState,
  newCliToken,
  newDeviceCode,
  newUserCode,
  normaliseUserCode,
} from "./cli-auth";

describe("codes and tokens", () => {
  it("user codes are readable and unique", () => {
    const codes = Array.from({ length: 300 }, () => newUserCode());
    expect(new Set(codes).size).toBe(300);
    for (const c of codes) {
      expect(c).toMatch(/^[A-HJKMN-TV-Z2-9]{4}-[A-HJKMN-TV-Z2-9]{4}$/);
      // Glyphs people confuse when reading aloud must never appear.
      expect(c).not.toMatch(/[ILOU01]/);
    }
  });

  it("device codes and tokens are long and unique", () => {
    expect(new Set(Array.from({ length: 200 }, () => newDeviceCode())).size).toBe(200);
    const token = newCliToken();
    expect(token.startsWith("cira_")).toBe(true);
    expect(token.length).toBe(69);
  });

  it("the user code is not the device code", () => {
    expect(newUserCode()).not.toEqual(newDeviceCode());
  });
});

describe("hashing", () => {
  it("is stable and does not contain the token", () => {
    const token = newCliToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).toHaveLength(64);
  });

  it("matches only identical hashes", () => {
    const a = hashToken("one");
    expect(hashesMatch(a, hashToken("one"))).toBe(true);
    expect(hashesMatch(a, hashToken("two"))).toBe(false);
    expect(hashesMatch(a, "short")).toBe(false);
    expect(hashesMatch(a, "")).toBe(false);
  });
});

describe("normaliseUserCode", () => {
  it("forgives case, spacing and a missing dash", () => {
    const code = newUserCode();
    const bare = code.replace("-", "");
    expect(normaliseUserCode(bare.toLowerCase())).toBe(code);
    expect(normaliseUserCode(` ${bare} `)).toBe(code);
    expect(normaliseUserCode(code)).toBe(code);
  });

  it("rejects wrong lengths and impossible characters", () => {
    for (const bad of [
      "",
      "ABC",
      "A".repeat(9),
      "OOOO-0000",
      "IIII-1111",
      "UUUU-2222",
      "LLLL-3333",
    ]) {
      expect(normaliseUserCode(bad)).toBeNull();
    }
  });
});

describe("loginState", () => {
  const now = new Date("2026-09-15T12:00:00Z");
  const future = new Date("2026-09-15T12:05:00Z");
  const past = new Date("2026-09-15T11:50:00Z");

  it("is pending before approval", () => {
    expect(
      loginState({ approvedAt: null, claimedAt: null, expiresAt: future }, now).status,
    ).toBe("pending");
  });

  it("is approved once someone says yes", () => {
    expect(
      loginState({ approvedAt: now, claimedAt: null, expiresAt: future }, now).status,
    ).toBe("approved");
  });

  it("cannot be claimed twice", () => {
    expect(
      loginState({ approvedAt: now, claimedAt: now, expiresAt: future }, now).status,
    ).toBe("claimed");
  });

  it("lapses when nobody approves it", () => {
    expect(
      loginState({ approvedAt: null, claimedAt: null, expiresAt: past }, now).status,
    ).toBe("expired");
  });

  it("an approved login still reports claimed once collected, never approved again", () => {
    // Order matters: a replayed poll must not hand out a second token.
    expect(
      loginState({ approvedAt: past, claimedAt: now, expiresAt: past }, now).status,
    ).toBe("claimed");
  });

  it("lapses in ten minutes", () => {
    expect(loginExpiry(now).toISOString()).toBe("2026-09-15T12:10:00.000Z");
  });
});
