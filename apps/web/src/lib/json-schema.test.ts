import { describe, expect, it } from "vitest";
import { validateInput } from "./json-schema";

const revenue = {
  type: "object",
  properties: {
    startDate: { type: "string" },
    endDate: { type: "string" },
    limit: { type: "integer" },
    currency: { type: "string", enum: ["USD", "EUR"] },
  },
  required: ["startDate", "endDate"],
};

describe("validateInput", () => {
  it("accepts input that fits", () => {
    const result = validateInput(revenue, {
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    expect(result).toEqual({
      ok: true,
      value: { startDate: "2026-08-01", endDate: "2026-08-31" },
    });
  });

  it("names the missing field rather than just refusing", () => {
    const result = validateInput(revenue, { startDate: "2026-08-01" });
    expect(result).toEqual({ ok: false, error: "endDate is required." });
  });

  it("rejects the wrong type", () => {
    expect(validateInput(revenue, { startDate: 1, endDate: "x" })).toEqual({
      ok: false,
      error: "startDate must be a string.",
    });
    expect(validateInput(revenue, { startDate: "a", endDate: "b", limit: 1.5 })).toEqual({
      ok: false,
      error: "limit must be a whole number.",
    });
  });

  it("enforces an enum", () => {
    expect(
      validateInput(revenue, { startDate: "a", endDate: "b", currency: "GBP" }),
    ).toEqual({ ok: false, error: "currency must be one of: USD, EUR." });
  });

  it("drops what the schema never described, so the app sees only its own fields", () => {
    const result = validateInput(revenue, {
      startDate: "a",
      endDate: "b",
      isAdmin: true,
      __proto__: { polluted: true },
    });
    expect(result).toEqual({ ok: true, value: { startDate: "a", endDate: "b" } });
  });

  it("treats no input as an empty object when nothing is required", () => {
    expect(validateInput({ type: "object", properties: {} }, undefined)).toEqual({
      ok: true,
      value: {},
    });
  });

  it("refuses input that is not an object at all", () => {
    expect(validateInput(revenue, "startDate=x")).toEqual({
      ok: false,
      error: "input must be an object.",
    });
    expect(validateInput(revenue, [1, 2])).toEqual({
      ok: false,
      error: "input must be an object.",
    });
  });

  it("checks inside a list", () => {
    const schema = {
      type: "object",
      properties: { ids: { type: "array", items: { type: "string" } } },
    };
    expect(validateInput(schema, { ids: ["a", "b"] }).ok).toBe(true);
    expect(validateInput(schema, { ids: ["a", 2] })).toEqual({
      ok: false,
      error: "ids[1] must be a string.",
    });
  });
});
