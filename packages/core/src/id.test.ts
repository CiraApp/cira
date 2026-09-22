import { describe, expect, it } from "vitest";
import {
  ID_PREFIXES,
  isId,
  isInviteToken,
  isSlug,
  newId,
  newInviteToken,
  RESERVED_SPACE_SLUGS,
  slugify,
  slugWithSuffix,
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

  it("never ends in a dash when a long name is cut", () => {
    // Fifty-three characters, cut at forty-eight between "authority" and "inc".
    const slug = slugify("Greater Northwestern Regional Transit Authority, Inc.");
    expect(slug).toBe("greater-northwestern-regional-transit-authority");
    expect(isSlug(slug)).toBe(true);
  });
});

describe("slugWithSuffix", () => {
  it("keeps the whole within the limit, so a second space of a long name opens", () => {
    const base = slugify("a".repeat(48));
    const second = slugWithSuffix(base, "2");
    expect(second.length).toBeLessThanOrEqual(48);
    expect(second.endsWith("-2")).toBe(true);
    expect(isSlug(second)).toBe(true);
  });

  it("does not leave a dash before the suffix when the cut lands on one", () => {
    expect(isSlug(slugWithSuffix(`${"b".repeat(45)}-cd`, "12"))).toBe(true);
  });
});

describe("RESERVED_SPACE_SLUGS", () => {
  it("covers every page Cira itself has at the top level", () => {
    for (const route of ["api", "cli", "demo", "docs", "enter", "invite", "legal"]) {
      expect(RESERVED_SPACE_SLUGS.has(route)).toBe(true);
    }
    for (const route of ["onboarding", "pricing", "sign-in", "sign-up", "monitoring"]) {
      expect(RESERVED_SPACE_SLUGS.has(route)).toBe(true);
    }
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
