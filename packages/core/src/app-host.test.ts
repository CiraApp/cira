import { describe, expect, it } from "vitest";
import {
  appHost,
  appLabel,
  customHostname,
  MAX_LABEL,
  parseAppHost,
  parseAppLabel,
} from "./app-host.js";
import { slugify } from "./id.js";

describe("appLabel", () => {
  it("joins an app and its space", () => {
    expect(appLabel({ appSlug: "ledger", spaceSlug: "acme" })).toBe("ledger--acme");
  });

  /**
   * The reason for the double hyphen. These two are different apps in
   * different companies; a single separator would give both `ledger-acme-corp`
   * and send one company's people to the other's app. The same ambiguity in
   * Cloud Run service names already let two apps share one service.
   */
  it("keeps two companies apart where one separator would not", () => {
    const first = appLabel({ appSlug: "ledger", spaceSlug: "acme-corp" });
    const second = appLabel({ appSlug: "ledger-acme", spaceSlug: "corp" });
    expect(first).toBe("ledger--acme-corp");
    expect(second).toBe("ledger-acme--corp");
    expect(first).not.toBe(second);
  });

  // The property that makes the separator safe, checked against the real
  // slugify rather than assumed: it collapses runs, so `--` cannot survive it.
  it("cannot be produced by any slug", () => {
    for (const input of [
      "Acme -- Corp",
      "a__b",
      "x  -  y",
      "Ledger——Acme",
      "!!!",
      "a---------b",
    ]) {
      expect(slugify(input)).not.toContain("--");
    }
  });

  it("refuses a pair too long to be a DNS label", () => {
    const long = "a".repeat(40);
    expect(appLabel({ appSlug: long, spaceSlug: long })).toBeNull();
  });

  it("allows a pair that exactly fits", () => {
    const half = "a".repeat((MAX_LABEL - 2) / 2);
    const label = appLabel({ appSlug: half, spaceSlug: half });
    expect(label).not.toBeNull();
    expect(label?.length).toBeLessThanOrEqual(MAX_LABEL);
  });

  it("refuses anything that is not a slug", () => {
    expect(appLabel({ appSlug: "Ledger", spaceSlug: "acme" })).toBeNull();
    expect(appLabel({ appSlug: "led ger", spaceSlug: "acme" })).toBeNull();
    expect(appLabel({ appSlug: "-ledger", spaceSlug: "acme" })).toBeNull();
    expect(appLabel({ appSlug: "led--ger", spaceSlug: "acme" })).toBeNull();
  });
});

describe("parseAppLabel", () => {
  it("round-trips", () => {
    for (const address of [
      { appSlug: "ledger", spaceSlug: "acme" },
      { appSlug: "env-probe", spaceSlug: "paradym" },
      { appSlug: "a", spaceSlug: "b" },
    ]) {
      const label = appLabel(address);
      expect(label).not.toBeNull();
      expect(parseAppLabel(label as string)).toEqual(address);
    }
  });

  it("refuses a label it cannot read one way", () => {
    expect(parseAppLabel("ledger")).toBeNull();
    expect(parseAppLabel("a--b--c")).toBeNull();
    expect(parseAppLabel("--acme")).toBeNull();
    expect(parseAppLabel("ledger--")).toBeNull();
  });
});

describe("parseAppHost", () => {
  it("reads an address off a hostname", () => {
    expect(parseAppHost("ledger--acme.cira.dev", "cira.dev")).toEqual({
      appSlug: "ledger",
      spaceSlug: "acme",
    });
    expect(parseAppHost("LEDGER--ACME.CIRA.DEV", "cira.dev")).toEqual({
      appSlug: "ledger",
      spaceSlug: "acme",
    });
    expect(parseAppHost("ledger--acme.cira.dev:443", "cira.dev")).toEqual({
      appSlug: "ledger",
      spaceSlug: "acme",
    });
  });

  /**
   * Cira's own hostnames have no separator, so they can never be mistaken for
   * an app - which is what removes the need for a list of reserved names.
   */
  it("does not see an app in Cira's own addresses", () => {
    for (const host of ["cira.dev", "www.cira.dev", "api.cira.dev", "docs.cira.dev"]) {
      expect(parseAppHost(host, "cira.dev")).toBeNull();
    }
  });

  it("refuses a hostname from somewhere else", () => {
    expect(parseAppHost("ledger--acme.example.com", "cira.dev")).toBeNull();
    expect(parseAppHost("ledger--acme.cira.dev.evil.test", "cira.dev")).toBeNull();
  });
});

describe("appHost", () => {
  it("is the label under the apps domain", () => {
    expect(appHost({ appSlug: "ledger", spaceSlug: "acme" }, "cira.dev")).toBe(
      "ledger--acme.cira.dev",
    );
  });
});

describe("customHostname", () => {
  const check = (input: string) => customHostname(input, "cira.dev");

  it("takes a subdomain of a company's own, lowercased", () => {
    expect(check(" Tools.Acme.com. ")).toEqual({ ok: true, hostname: "tools.acme.com" });
  });

  it("says why it will not take the rest", () => {
    for (const [input, says] of [
      ["https://tools.acme.com/", "no https://"],
      ["acme.com", "tools.acme.com"],
      ["ledger--acme.cira.dev", "Cira's own"],
      ["cira.dev", "Cira's own"],
      ["10.0.0.1", "not a name"],
      ["bad_name.acme.com", "not a name"],
      ["-x.acme.com", "not a name"],
    ] as const) {
      const result = check(input);
      expect(result.ok, input).toBe(false);
      expect(!result.ok && result.reason, input).toContain(says);
    }
  });
});
