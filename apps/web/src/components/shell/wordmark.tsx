import type { Route } from "next";
import Link from "next/link";
import { CiraWordmark } from "./mark";

/**
 * The brand, signed at the foot of the spine rather than announced at the top.
 *
 * Whose product this is is the one thing on screen nobody has to be told
 * twice, so it takes the quietest position in the layout and leaves the top of
 * the sidebar to the thing that actually scopes the page: which company you
 * are in.
 *
 * The name alone, without the mark. The mark already sits at the front of the
 * Ask Cira box and on the Ask Cira button in the header, and a third copy in
 * the corner of the same screen stopped being a signature and started being
 * repetition.
 *
 * It sits centred between the sidebar's edge and the gear beside it - the
 * drawn gear, not the button around it. That button is a 32px target around an
 * 18px glyph, 7px of air each side, so centring on its box leaves the name
 * visibly 7px nearer the edge. The row therefore gaps the button by its 10px
 * padding less those 7px: 3px, which puts the name's box exactly as far from
 * the gear as from the edge.
 */
export function Wordmark({ href }: { href: Route }) {
  return (
    <Link
      href={href}
      aria-label="Cira home"
      title="Cira"
      className="flex shrink-0 items-center rounded-[var(--radius-edge)] px-2.5 py-1.5 text-ink-subtle transition-colors duration-200 hover:text-ink"
    >
      <CiraWordmark className="h-[13px] w-auto" />
    </Link>
  );
}
