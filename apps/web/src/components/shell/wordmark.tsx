import type { Route } from "next";
import Link from "next/link";
import { CiraMark } from "./mark";

/**
 * The brand, signed at the foot of the spine rather than announced at the top.
 *
 * Whose product this is is the one thing on screen nobody has to be told
 * twice, so it takes the quietest position in the layout and leaves the top of
 * the sidebar to the thing that actually scopes the page: which company you
 * are in.
 */
export function Wordmark({
  href,
  showName = false,
}: {
  href: Route;
  showName?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-label="Cira home"
      title="Cira"
      className="group flex shrink-0 items-center gap-2 rounded-[var(--radius-edge)] px-1 py-1 text-ink-subtle transition-colors duration-200 hover:text-ink"
    >
      <CiraMark className="h-[17px] w-[17px] transition-transform duration-300 ease-[var(--ease-spring)] group-hover:scale-110" />
      {showName ? (
        <span className="text-[13px] font-semibold tracking-[-0.02em]">Cira</span>
      ) : null}
    </Link>
  );
}
