import { describe, expect, it } from "vitest";
import { MAX_NAME_PART, parsePersonName } from "./person-name";

describe("parsePersonName", () => {
  it("keeps a first and last name, and joins them for display", () => {
    expect(parsePersonName("  Aum ", " Kirtania ")).toEqual({
      ok: true,
      firstName: "Aum",
      lastName: "Kirtania",
      name: "Aum Kirtania",
    });
  });

  it("takes a first name on its own", () => {
    expect(parsePersonName("Aum", "")).toEqual({
      ok: true,
      firstName: "Aum",
      lastName: null,
      name: "Aum",
    });
  });

  it("keeps a first name that is more than one word", () => {
    const parsed = parsePersonName("Mary  Ann", "Smith");
    expect(parsed.ok && parsed.firstName).toBe("Mary Ann");
  });

  it("needs a first name", () => {
    expect(parsePersonName("   ", "Kirtania").ok).toBe(false);
    expect(parsePersonName(null, null).ok).toBe(false);
  });

  // An address is what Cira showed in place of a name; accepting one here
  // would put it straight back.
  it("refuses an email address as a name", () => {
    expect(parsePersonName("akirtania17@gmail.com", "").ok).toBe(false);
  });

  it("refuses a name longer than it can be shown", () => {
    expect(parsePersonName("x".repeat(MAX_NAME_PART + 1), "").ok).toBe(false);
  });
});
