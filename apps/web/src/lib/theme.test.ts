import { describe, expect, it } from "vitest";
import {
  BUILT_IN,
  PRESETS,
  hexToHsl,
  hslToHex,
  accentInk,
  contrast,
  isHexColor,
  luminance,
  modeFor,
  normalizeHex,
  parseTheme,
  readableOn,
} from "./theme";

describe("isHexColor", () => {
  it("accepts six-digit hex", () => {
    expect(isHexColor("#08090c")).toBe(true);
    expect(isHexColor("#FFFFFF")).toBe(true);
  });

  it("rejects everything else", () => {
    for (const value of ["#fff", "08090c", "#gggggg", "", "#0809 0c", "red"]) {
      expect(isHexColor(value)).toBe(false);
    }
  });
});

describe("normalizeHex", () => {
  it("adds the hash and lowercases", () => {
    expect(normalizeHex("08090C")).toBe("#08090c");
    expect(normalizeHex("  #5B85FF ")).toBe("#5b85ff");
  });

  it("returns null for anything it cannot use", () => {
    expect(normalizeHex("#fff")).toBeNull();
    expect(normalizeHex("nope")).toBeNull();
  });
});

describe("luminance", () => {
  it("spans black to white", () => {
    expect(luminance("#000000")).toBeCloseTo(0, 5);
    expect(luminance("#ffffff")).toBeCloseTo(1, 5);
  });
});

describe("contrast", () => {
  it("is 21 for black on white, either way round", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 4);
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 4);
  });

  it("is 1 for a colour against itself", () => {
    expect(contrast("#5b85ff", "#5b85ff")).toBeCloseTo(1, 5);
  });
});

describe("readableOn", () => {
  it("picks the more legible ink, not the one a midpoint would give", () => {
    // #5b85ff sits below the usual luminance midpoint but still carries dark
    // text better than light. This is the case a threshold gets wrong.
    expect(readableOn("#5b85ff")).toBe("black");
    expect(readableOn("#2f5cf5")).toBe("white");
  });
});

describe("modeFor", () => {
  it("agrees with the shipped palettes", () => {
    expect(modeFor(BUILT_IN.dark.base)).toBe("dark");
    expect(modeFor(BUILT_IN.light.base)).toBe("light");
  });

  it("classifies every preset the way its name implies", () => {
    const byName = Object.fromEntries(PRESETS.map((p) => [p.name, modeFor(p.base)]));
    expect(byName["Midnight"]).toBe("dark");
    expect(byName["Moss"]).toBe("dark");
    expect(byName["Paper"]).toBe("light");
    expect(byName["Bone"]).toBe("light");
  });
});

describe("accentInk", () => {
  it("reproduces the hand-picked values the design shipped with", () => {
    expect(accentInk("#5b85ff")).toBe("#0a0a0c");
    expect(accentInk("#2f5cf5")).toBe("#ffffff");
  });
});

describe("parseTheme", () => {
  it("round-trips a stored theme", () => {
    expect(parseTheme(JSON.stringify(BUILT_IN.dark))).toEqual(BUILT_IN.dark);
  });

  it("treats nothing stored as no choice made", () => {
    expect(parseTheme(null)).toBeNull();
  });

  it("refuses anything it cannot trust rather than breaking the page", () => {
    for (const raw of [
      "not json",
      "null",
      "[]",
      '{"base":"#08090c"}',
      '{"base":"red","accent":"#5b85ff"}',
      '{"base":"#08090c","accent":42}',
    ]) {
      expect(parseTheme(raw)).toBeNull();
    }
  });
});

describe("hexToHsl and hslToHex", () => {
  it("round-trips every preset colour exactly", () => {
    for (const preset of PRESETS) {
      for (const hex of [preset.base, preset.accent]) {
        expect(hslToHex(hexToHsl(hex))).toBe(hex);
      }
    }
  });

  it("round-trips the greys, where hue is undefined", () => {
    for (const hex of ["#000000", "#ffffff", "#7f7f7f", "#080808"]) {
      expect(hslToHex(hexToHsl(hex))).toBe(hex);
    }
  });

  it("puts the primaries where the wheel expects them", () => {
    expect(hexToHsl("#ff0000").h).toBeCloseTo(0, 4);
    expect(hexToHsl("#00ff00").h).toBeCloseTo(120, 4);
    expect(hexToHsl("#0000ff").h).toBeCloseTo(240, 4);
  });

  it("reads saturation and lightness off the ends of the range", () => {
    expect(hexToHsl("#ffffff")).toMatchObject({ s: 0, l: 1 });
    expect(hexToHsl("#000000")).toMatchObject({ s: 0, l: 0 });
    expect(hexToHsl("#ff0000")).toMatchObject({ s: 1, l: 0.5 });
  });

  it("wraps a hue that has run past the top of the wheel", () => {
    expect(hslToHex({ h: 360, s: 1, l: 0.5 })).toBe("#ff0000");
    expect(hslToHex({ h: -120, s: 1, l: 0.5 })).toBe("#0000ff");
  });
});
