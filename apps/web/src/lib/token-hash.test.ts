import { describe, expect, it } from "vitest";
import { newCliToken } from "./cli-auth";
import { hashToken, hashesMatch } from "./token-hash";

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
