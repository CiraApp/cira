import { describe, expect, it } from "vitest";
import { isId, newId, slugify } from "./id.js";

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
