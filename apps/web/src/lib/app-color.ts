/**
 * A stable identity colour for each app.
 *
 * People find apps in a gallery by shape and colour before they read the
 * label, so an app's colour must never change between visits. It is derived
 * from the app id, which is immutable, rather than the name, which is not.
 *
 * This is the only colour in the product that is not near-monochrome. The
 * chrome stays quiet precisely so these carry, which is what stops a shelf of
 * company software reading as an infrastructure console.
 *
 * The palette is hand-picked rather than generated: nine hues held at a
 * similar chroma and lightness so a full gallery reads as one set, each with a
 * light and a dark rendering because a wash that glows on paper goes muddy on
 * a dark ground.
 */

export interface AppColor {
  /** Icon foreground, light theme. */
  fg: string;
  /** Icon background wash, light theme. */
  bg: string;
  /** Icon foreground, dark theme. */
  fgDark: string;
  /** Icon background wash, dark theme. */
  bgDark: string;
  /** RGB triplet for the card's hover glow, in both themes. */
  glow: string;
}

const PALETTE: readonly AppColor[] = [
  {
    fg: "#2347e8",
    bg: "#e6ebfd",
    fgDark: "#93aaff",
    bgDark: "#1a2138",
    glow: "35 71 232",
  },
  {
    fg: "#0d7d72",
    bg: "#dff3f0",
    fgDark: "#57cfc0",
    bgDark: "#0e2a28",
    glow: "13 125 114",
  },
  {
    fg: "#b4590f",
    bg: "#fbeade",
    fgDark: "#f0a463",
    bgDark: "#2e1f13",
    glow: "180 89 15",
  },
  {
    fg: "#c02d5b",
    bg: "#fce6ec",
    fgDark: "#f58aa8",
    bgDark: "#301721",
    glow: "192 45 91",
  },
  {
    fg: "#6b3fd4",
    bg: "#eee7fc",
    fgDark: "#b298f7",
    bgDark: "#231a3a",
    glow: "107 63 212",
  },
  {
    fg: "#0a6ba8",
    bg: "#e0eff9",
    fgDark: "#66b7e6",
    bgDark: "#0d2434",
    glow: "10 107 168",
  },
  {
    fg: "#2c7a3f",
    bg: "#e4f2e6",
    fgDark: "#69c47e",
    bgDark: "#122617",
    glow: "44 122 63",
  },
  {
    fg: "#8a5a10",
    bg: "#f7eeda",
    fgDark: "#dcb05a",
    bgDark: "#2a2113",
    glow: "138 90 16",
  },
  {
    fg: "#7a3aa8",
    bg: "#f3e8fa",
    fgDark: "#c491e8",
    bgDark: "#271836",
    glow: "122 58 168",
  },
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
