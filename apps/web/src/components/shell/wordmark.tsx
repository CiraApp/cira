import type { Route } from "next";
import Link from "next/link";
import { CiraMark, CiraWordmark } from "./mark";

/**
 * The brand, signed at the foot of the spine rather than announced at the top.
 *
 * Whose product this is is the one thing on screen nobody has to be told
 * twice, so it takes the quietest position in the layout and leaves the top of
 * the sidebar to the thing that actually scopes the page: which company you
 * are in.
 *
 * Mark and name are two drawings rather than a drawing and a line of type, so
 * the lockup holds its proportions exactly: the name is 83% of the mark's
 * height.
 *
 * The name is then lifted 2px off the centre line. Its box runs from the top
 * of the i's dot to the baseline, so centring the two boxes hangs the letters
 * low - the dot is a small accent carrying a third of the box while the mark
 * is solid to both edges. Two pixels puts the middle of the x-height on the
 * mark's channel, which is where the eye reads the pair as level.
 *
 * The space between them is a third of the mark's height rather than the
 * fourteenth the two were drawn at. That drawing was a hero lockup; at 18px
 * the mark's bevelled arms reach far enough to the right that the c sits in
 * their shadow, and the pair reads as one crowded glyph.
 *
 * It carries the nav rows' own horizontal padding rather than a tighter one
 * of its own, so the mark starts on the same line as the icons above it. That
 * only began to matter when Settings left the foot: a signature tucked beside
 * something else can sit where it likes, but alone at the bottom of a column
 * it is read against that column.
 *
 * 18px rather than the 15px the old single-stroke mark ran at. The channel
 * between the two chevrons is a fourteenth of the mark's height, so below
 * about 18px it closes up on a 1x screen and the pair reads as one smudged
 * arrow instead of two strokes.
 */
export function Wordmark({ href }: { href: Route }) {
  return (
    <Link
      href={href}
      aria-label="Cira home"
      title="Cira"
      className="group flex shrink-0 items-center gap-[6px] rounded-[var(--radius-edge)] px-2.5 py-1.5 text-ink-subtle transition-colors duration-200 hover:text-ink"
    >
      <CiraMark className="h-[18px] w-auto transition-transform duration-300 ease-[var(--ease-spring)] group-hover:scale-110" />
      <CiraWordmark className="h-[15px] w-auto -translate-y-[2px]" />
    </Link>
  );
}
