import { describe, expect, it } from "vitest";
import {
  MAX_VALUE_BYTES,
  MAX_VARS,
  envSchema,
  fingerprint,
  isPublicName,
} from "./env-vars";

describe("envSchema", () => {
  it("accepts an ordinary set", () => {
    expect(
      envSchema.safeParse({ DATABASE_URL: "postgres://x", API_KEY: "sk-1" }).success,
    ).toBe(true);
  });

  it("accepts nothing at all, which is how variables get cleared", () => {
    expect(envSchema.safeParse({}).success).toBe(true);
  });

  it("rejects names a shell or a build would not take", () => {
    for (const bad of ["9LEAD", "has-dash", "has space", "", "a.b"]) {
      expect(envSchema.safeParse({ [bad]: "x" }).success).toBe(false);
    }
  });

  it("rejects more variables than an app should have", () => {
    const many: Record<string, string> = {};
    for (let i = 0; i <= MAX_VARS; i += 1) many[`K${i}`] = "v";
    expect(envSchema.safeParse(many).success).toBe(false);
  });

  it("rejects a value too large to be a variable", () => {
    expect(envSchema.safeParse({ BIG: "x".repeat(MAX_VALUE_BYTES + 1) }).success).toBe(
      false,
    );
  });

  it("measures size in bytes, not characters", () => {
    // A multi-byte value that passes a character count and fails a byte count
    // is exactly the input that slips past a naive limit.
    const value = "é".repeat(MAX_VALUE_BYTES - 1);
    expect(Buffer.byteLength(value, "utf8")).toBeGreaterThan(MAX_VALUE_BYTES);
    expect(envSchema.safeParse({ ACCENTED: value }).success).toBe(false);
  });

  it("rejects a set that is too large in total", () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 50; i += 1) many[`K${i}`] = "x".repeat(2000);
    expect(envSchema.safeParse(many).success).toBe(false);
  });
});

describe("fingerprint", () => {
  it("is stable for the same value", () => {
    expect(fingerprint("hunter2")).toBe(fingerprint("hunter2"));
  });

  it("differs when the value changes", () => {
    expect(fingerprint("hunter2")).not.toBe(fingerprint("hunter3"));
  });

  it("is short enough not to be worth attacking", () => {
    // The point is "did this change", not "prove what it was". A full digest of
    // a short secret is worth brute-forcing; eight hex characters is not.
    const print = fingerprint("sk-ant-api-secret");
    expect(print).toHaveLength(8);
    expect(print).toMatch(/^[0-9a-f]{8}$/);
  });

  it("does not contain the value", () => {
    expect(fingerprint("hunter2")).not.toContain("hunter2");
  });
});

describe("isPublicName", () => {
  it("flags only what the build inlines into the browser", () => {
    expect(isPublicName("NEXT_PUBLIC_URL")).toBe(true);
    expect(isPublicName("SECRET_KEY")).toBe(false);
    expect(isPublicName("NEXT_PUBLICITY")).toBe(false);
  });
});
