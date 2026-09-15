import { describe, expect, it } from "vitest";
import { appColor, appInitial } from "./app-color";

describe("appColor", () => {
  it("is stable for the same app", () => {
    expect(appColor("app_revenue")).toEqual(appColor("app_revenue"));
  });

  it("spreads different apps across the palette", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `app_${i}`);
    const distinct = new Set(ids.map((id) => appColor(id).fg));
    expect(distinct.size).toBeGreaterThan(4);
  });

  it("always returns a usable colour, including for empty input", () => {
    for (const id of ["", "a", "app_" + "z".repeat(200)]) {
      const c = appColor(id);
      expect(c.fg).toMatch(/^#[0-9a-f]{6}$/);
      expect(c.bg).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("appInitial", () => {
  it("takes the first letter, uppercased", () => {
    expect(appInitial("Revenue Dashboard")).toBe("R");
    expect(appInitial("  payroll")).toBe("P");
  });

  it("falls back rather than rendering nothing", () => {
    expect(appInitial("   ")).toBe("?");
    expect(appInitial("")).toBe("?");
  });
});
