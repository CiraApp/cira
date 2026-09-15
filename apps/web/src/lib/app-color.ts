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
 * similar, deliberately LOW chroma, each with a light and a dark rendering
 * because a wash that works on paper goes muddy on a dark ground.
 *
 * They are muted on purpose. Gold is the product's identity and the only
 * saturated colour it owns; a grid of bright icons underneath it would read as
 * two designs arguing. These carry just enough hue to tell one app from
 * another at a glance, and no more.
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
    fg: "#5a6478",
    bg: "#eef0f4",
    fgDark: "#a9b4c8",
    bgDark: "#191c22",
    glow: "90 100 120",
  },
  {
    fg: "#4a6a64",
    bg: "#eaf1ef",
    fgDark: "#9bbdb5",
    bgDark: "#151d1c",
    glow: "74 106 100",
  },
  {
    fg: "#7a6247",
    bg: "#f4efe8",
    fgDark: "#c8b094",
    bgDark: "#201b15",
    glow: "122 98 71",
  },
  {
    fg: "#7a5560",
    bg: "#f4ecee",
    fgDark: "#c9a5ae",
    bgDark: "#201619",
    glow: "122 85 96",
  },
  {
    fg: "#635a7a",
    bg: "#f0eef5",
    fgDark: "#b0a7ca",
    bgDark: "#1a1822",
    glow: "99 90 122",
  },
  {
    fg: "#4d6579",
    bg: "#ebf0f4",
    fgDark: "#a2bcd0",
    bgDark: "#161c22",
    glow: "77 101 121",
  },
  {
    fg: "#546e54",
    bg: "#edf2ed",
    fgDark: "#a6c4a6",
    bgDark: "#171d17",
    glow: "84 110 84",
  },
  {
    fg: "#736545",
    bg: "#f2efe7",
    fgDark: "#c4b48e",
    bgDark: "#1e1c14",
    glow: "115 101 69",
  },
  {
    fg: "#6a5670",
    bg: "#f1eef2",
    fgDark: "#bda6c3",
    bgDark: "#1c171e",
    glow: "106 86 112",
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
