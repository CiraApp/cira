/**
 * A stable identity colour for each app.
 *
 * People find apps in a gallery by shape and colour before they read the
 * label, so an app's colour must never change between visits. It is derived
 * from the app id, which is immutable, rather than the name, which is not.
 *
 * The palette is hand-picked rather than generated: eight hues at a similar
 * perceived lightness, so a full gallery reads as one set instead of confetti.
 */

export interface AppColor {
  /** Icon foreground. */
  fg: string;
  /** Icon background wash. */
  bg: string;
  /** Accent used for the card's hover glow. */
  glow: string;
}

const PALETTE: readonly AppColor[] = [
  { fg: "#5b4bd6", bg: "#eeecff", glow: "91 75 214" },
  { fg: "#0d9488", bg: "#e6f6f4", glow: "13 148 136" },
  { fg: "#c2620a", bg: "#fdf0e0", glow: "194 98 10" },
  { fg: "#d1395b", bg: "#fdeaee", glow: "209 57 91" },
  { fg: "#7c3aed", bg: "#f3ecff", glow: "124 58 237" },
  { fg: "#0670a8", bg: "#e4f2fa", glow: "6 112 168" },
  { fg: "#2f855a", bg: "#e8f5ee", glow: "47 133 90" },
  { fg: "#b45309", bg: "#fbf0df", glow: "180 83 9" },
];

export function appColor(appId: string): AppColor {
  let hash = 0;
  for (let i = 0; i < appId.length; i += 1) {
    hash = (hash * 31 + appId.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % PALETTE.length;
  return PALETTE[index] as AppColor;
}

/** The letter shown when an app has no icon of its own. */
export function appInitial(name: string): string {
  const first = name.trim().charAt(0);
  return first === "" ? "?" : first.toUpperCase();
}
