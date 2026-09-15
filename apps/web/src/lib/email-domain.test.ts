import { describe, expect, it } from "vitest";
import { claimableDomain, emailDomain, isPublicEmailDomain } from "./email-domain";

describe("emailDomain", () => {
  it("takes the part after the last @", () => {
    expect(emailDomain("dana@acme.com")).toBe("acme.com");
    expect(emailDomain("odd@name@acme.co.uk")).toBe("acme.co.uk");
  });

  it("normalises case and surrounding space", () => {
    expect(emailDomain("Dana@ACME.com  ")).toBe("acme.com");
  });

  it("rejects anything that is not a routable domain", () => {
    for (const bad of [
      "",
      "dana",
      "dana@",
      "@acme.com",
      "dana@localhost",
      "dana@.com",
      "dana@acme.",
    ]) {
      expect(emailDomain(bad)).toBeNull();
    }
  });
});

describe("claimableDomain", () => {
  it("claims a company domain", () => {
    expect(claimableDomain("aum@acme.com")).toBe("acme.com");
  });

  it("refuses providers anyone can sign up at", () => {
    for (const email of [
      "a@gmail.com",
      "a@GMAIL.com",
      "a@outlook.com",
      "a@icloud.com",
      "a@proton.me",
      "a@example.com",
    ]) {
      expect(claimableDomain(email)).toBeNull();
    }
  });

  it("refuses malformed addresses rather than guessing", () => {
    expect(claimableDomain("nope")).toBeNull();
    expect(claimableDomain("nope@")).toBeNull();
  });
});

describe("isPublicEmailDomain", () => {
  it("is case and whitespace insensitive", () => {
    expect(isPublicEmailDomain(" Gmail.COM ")).toBe(true);
    expect(isPublicEmailDomain("acme.com")).toBe(false);
  });
});
