import { describe, expect, it } from "vitest";
import {
  ID_PREFIXES,
  isId,
  isInviteToken,
  isSlug,
  newId,
  newInviteToken,
  slugify,
} from "./id.js";

describe("newId", () => {
  it("prefixes by kind and is unique", () => {
    const a = newId("app");
    const b = newId("app");
    expect(a.startsWith("app_")).toBe(true);
    expect(a).not.toEqual(b);
  });

  it("recognises its own ids and rejects other kinds", () => {
    const space = newId("space");
    expect(isId("space", space)).toBe(true);
    expect(isId("app", space)).toBe(false);
  });

  it("gives every kind a prefix of its own", () => {
    // A missing entry produces "undefined_..." rather than failing, so the ids
    // of a whole table silently lose the one thing they are prefixed for.
    const prefixes = Object.values(ID_PREFIXES);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    for (const kind of Object.keys(ID_PREFIXES) as Array<keyof typeof ID_PREFIXES>) {
      expect(newId(kind).startsWith(`${ID_PREFIXES[kind]}_`)).toBe(true);
    }
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Revenue Dashboard")).toBe("revenue-dashboard");
  });

  it("strips accents and punctuation", () => {
    expect(slugify("Café  Métrics!!")).toBe("cafe-metrics");
  });

  it("trims leading and trailing separators", () => {
    expect(slugify("  --Acme Inc.--  ")).toBe("acme-inc");
  });

  it("collapses to empty for input with nothing usable", () => {
    expect(slugify("!!!")).toBe("");
  });
});

describe("isSlug", () => {
  it("accepts what slugify produces", () => {
    for (const name of ["Acme", "Revenue Dashboard", "Café Métrics"]) {
      expect(isSlug(slugify(name))).toBe(true);
    }
  });

  it("rejects file-like paths that would otherwise hit the space route", () => {
    for (const path of [
      "favicon.ico",
      "robots.txt",
      "apple-touch-icon.png",
      ".well-known",
      "sitemap.xml",
    ]) {
      expect(isSlug(path)).toBe(false);
    }
  });

  it("rejects empty, uppercase, and malformed slugs", () => {
    for (const bad of ["", "Acme", "-acme", "acme-", "ac--me", "a b", "a".repeat(49)]) {
      expect(isSlug(bad)).toBe(false);
    }
  });
});

describe("invite tokens", () => {
  it("are unguessable and unique", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newInviteToken()));
    expect(tokens.size).toBe(200);
    for (const t of tokens) expect(isInviteToken(t)).toBe(true);
  });

  it("reject anything not issued by us", () => {
    for (const bad of ["", "abc", "z".repeat(64), "a".repeat(63), "a".repeat(65)]) {
      expect(isInviteToken(bad)).toBe(false);
    }
  });
});
