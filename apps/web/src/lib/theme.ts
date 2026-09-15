/**
 * The interface's two colours.
 *
 * Everything on screen is derived from a base and an accent: the base is the
 * ground the work sits on, the accent is the one colour spent on the active
 * thing and the primary action. Every other token - panels, hairlines, three
 * weights of ink - is mixed from the base in CSS, so this module only has to
 * settle the handful of questions CSS cannot answer for itself.
 *
 * There is no light/dark switch any more. A base colour either is dark or it
 * is not, and asking someone to tell us which after they have just shown us is
 * the kind of question the product does not ask.
 */

export interface Theme {
  /** `#rrggbb`. */
  base: string;
  /** `#rrggbb`. */
  accent: string;
}

export type Mode = "light" | "dark";

/** Where the interface starts before anyone chooses: Cira's own two palettes. */
export const BUILT_IN: Record<Mode, Theme> = {
  dark: { base: "#08090c", accent: "#5b85ff" },
  light: { base: "#f4f5f7", accent: "#2f5cf5" },
};

export interface Preset extends Theme {
  name: string;
}

/**
 * Starting points, not a menu. Any pair of colours is allowed; these exist so
 * that the first thing someone sees when they open the picker is a set of
 * pairs that already work, rather than two colour wells and no idea.
 */
export const PRESETS: readonly Preset[] = [
  { name: "Midnight", base: "#08090c", accent: "#5b85ff" },
  { name: "Graphite", base: "#0e0e10", accent: "#e4e4e7" },
  { name: "Moss", base: "#080d0a", accent: "#4ade80" },
  { name: "Ember", base: "#110b09", accent: "#fb923c" },
  { name: "Plum", base: "#0d0912", accent: "#c084fc" },
  { name: "Paper", base: "#f4f5f7", accent: "#2f5cf5" },
  { name: "Bone", base: "#f7f5f1", accent: "#b45309" },
];

const HEX = /^#[0-9a-f]{6}$/i;

/** True for `#rrggbb` and nothing else. Three-digit hex is not accepted. */
export function isHexColor(value: string): boolean {
  return HEX.test(value.trim());
}

export function normalizeHex(value: string): string | null {
  const trimmed = value.trim();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return isHexColor(withHash) ? withHash.toLowerCase() : null;
}

function channels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex);
  const linear = (value: number) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Black or white, whichever is more legible on this colour.
 *
 * Used both for the mode and for the text on the accent, which is why it is
 * one function. A threshold on luminance would be simpler and would get the
 * shipped accent wrong: #5b85ff sits below the usual midpoint but still takes
 * dark text, because that is the pair with more contrast.
 */
export function readableOn(background: string): "black" | "white" {
  return contrast(background, "#ffffff") > contrast(background, "#000000")
    ? "white"
    : "black";
}

/**
 * Is this a dark interface?
 *
 * Decided by which ink the base can carry, so the answer and the text it
 * implies can never disagree.
 */
export function modeFor(base: string): Mode {
  return readableOn(base) === "white" ? "dark" : "light";
}

/** The ink that goes on top of the accent: the primary button's label. */
export function accentInk(accent: string): string {
  return readableOn(accent) === "white" ? "#ffffff" : "#0a0a0c";
}

/**
 * How legible the accent is against the base.
 *
 * Surfaced in the picker rather than enforced: someone choosing their own
 * colours is allowed to choose badly, but they should be able to see that
 * they have. 3:1 is the WCAG floor for interface components.
 */
export function accentContrast(theme: Theme): number {
  return contrast(theme.accent, theme.base);
}

const STORAGE_KEY = "cira-theme";

/** What the browser stores. Null means "follow the system", the default. */
export function parseTheme(raw: string | null): Theme | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { base, accent } = value as Record<string, unknown>;
    if (typeof base !== "string" || typeof accent !== "string") return null;
    const safeBase = normalizeHex(base);
    const safeAccent = normalizeHex(accent);
    if (safeBase === null || safeAccent === null) return null;
    return { base: safeBase, accent: safeAccent };
  } catch {
    // A hand-edited or half-written value is not worth a broken page.
    return null;
  }
}

export const THEME_STORAGE_KEY = STORAGE_KEY;
