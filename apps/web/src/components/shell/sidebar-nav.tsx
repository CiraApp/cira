"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface NavItem {
  label: string;
  /** Typed so a nav entry cannot point at a route that does not exist. */
  href: Route;
  icon: "apps" | "recent" | "deploy" | "members" | "billing" | "settings" | "profile";
}

/**
 * The spine of the product.
 *
 * The active item is marked by a hairline rail and a quiet panel behind it,
 * and both are single elements that slide from one item to the next rather
 * than appearing on the new one and vanishing from the old. That is what makes
 * a sidebar feel like a position within a structure instead of five lights
 * being switched on and off, and it keeps the single accent doing a single
 * job.
 *
 * The indicator is measured rather than assumed: it reads the live geometry of
 * the active row, so it stays correct if the type scale, the padding or the
 * number of items ever changes.
 */
export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const listRef = useRef<HTMLElement>(null);
  const [marker, setMarker] = useState<{ top: number; height: number } | null>(null);
  // The first paint puts the marker in place with no animation; every move
  // after that is a slide. Without this the indicator flies in from the top
  // of the sidebar on every full page load.
  const [settled, setSettled] = useState(false);

  const activeHref = items.find((item) => isActive(pathname, item.href))?.href ?? null;

  // Layout effect, because this reads geometry and writes a position: doing it
  // in a passive effect shows one frame with the marker in the wrong place.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === null) return;

    const measure = () => {
      const active = list.querySelector<HTMLElement>("[data-active='true']");
      setMarker(
        active === null ? null : { top: active.offsetTop, height: active.offsetHeight },
      );
    };

    measure();

    // Fonts landing late change the row height, and so does a narrow window.
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [activeHref, items]);

  useEffect(() => {
    const id = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <nav ref={listRef} aria-label="Space" className="relative flex flex-col gap-0.5">
      {marker !== null ? (
        <>
          <span
            aria-hidden="true"
            style={{ transform: `translateY(${marker.top}px)`, height: marker.height }}
            className={`absolute inset-x-0 top-0 rounded-[var(--radius-edge)] bg-sunken ${
              settled
                ? "transition-transform duration-[320ms] ease-[var(--ease-spring)]"
                : ""
            }`}
          />
          <span
            aria-hidden="true"
            style={{
              transform: `translateY(${marker.top + (marker.height - 15) / 2}px)`,
            }}
            className={`absolute top-0 left-0 z-20 h-[15px] w-[2px] bg-accent ${
              settled
                ? "transition-transform duration-[320ms] ease-[var(--ease-spring)]"
                : ""
            }`}
          />
        </>
      ) : null}

      {items.map((item) => {
        const active = item.href === activeHref;

        return (
          <Link
            key={item.href}
            href={item.href}
            data-active={active ? "true" : "false"}
            aria-current={active ? "page" : undefined}
            className={`group relative flex items-center gap-2.5 rounded-[var(--radius-edge)] px-2.5 py-[7px] text-[13px] font-medium transition-colors duration-200 ${
              active ? "text-ink" : "text-ink-muted hover:bg-sunken/60 hover:text-ink"
            }`}
          >
            <NavIcon name={item.icon} active={active} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** A section is active for its own page and for anything nested under it. */
function isActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  return href.split("/").length > 2 && pathname.startsWith(`${href}/`);
}

/** Exported so the settings gear at the foot is the same drawing, not a copy. */
export function NavIcon({
  name,
  active,
  sizeClass = "h-[15px] w-[15px]",
}: {
  name: NavItem["icon"];
  active: boolean;
  /** 15px reads as a label's companion in a row; the foot wants the mark's own height. */
  sizeClass?: string;
}) {
  const paths: Record<NavItem["icon"], React.ReactNode> = {
    apps: (
      <>
        <rect x="2.2" y="2.2" width="5.2" height="5.2" rx="1" />
        <rect x="10.4" y="2.2" width="5.2" height="5.2" rx="1" />
        <rect x="2.2" y="10.4" width="5.2" height="5.2" rx="1" />
        <rect x="10.4" y="10.4" width="5.2" height="5.2" rx="1" />
      </>
    ),
    recent: (
      <>
        <circle cx="9" cy="9" r="6.6" />
        <path d="M9 5.2V9l2.6 1.6" />
      </>
    ),
    deploy: (
      <>
        <path d="M9 12.6V3.4M9 3.4 5.6 6.8M9 3.4l3.4 3.4" />
        <path d="M3.4 12v1.9a1.3 1.3 0 0 0 1.3 1.3h8.6a1.3 1.3 0 0 0 1.3-1.3V12" />
      </>
    ),
    profile: (
      <>
        <circle cx="9" cy="6.2" r="2.9" />
        <path d="M3.6 15.2c0-2.9 2.4-4.8 5.4-4.8s5.4 1.9 5.4 4.8" />
      </>
    ),
    members: (
      <>
        <circle cx="6.9" cy="6.3" r="2.8" />
        <path d="M2.3 15c0-2.5 2.1-4.2 4.6-4.2s4.6 1.7 4.6 4.2" />
        <path d="M12.2 4.1a2.6 2.6 0 0 1 0 4.8M13.4 10.9c1.4.5 2.4 1.8 2.4 3.5" />
      </>
    ),
    // A card, because that is what paying looks like, with the stripe a card
    // carries. Not a dollar sign: what is behind it is a month's usage as
    // much as an amount.
    billing: (
      <>
        <rect x="1.8" y="4" width="14.4" height="10" rx="1.6" />
        <path d="M1.8 7.6h14.4" />
        <path d="M4.6 11.2h3.2" />
      </>
    ),
    // Drawn in the mark's vocabulary rather than a stock cog: every edge is
    // horizontal, vertical or on the same 45 degree diagonal, the corners are
    // mitred, and the body is a regular octagon carrying a tooth on each of
    // its eight edges. Four teeth left it reading as a crosshair; eight is
    // what makes it a gear, and a regular octagon is what keeps every root
    // long enough to still show a gap at 15px.
    settings: (
      <>
        <path
          strokeLinejoin="miter"
          d="M6.72 3.5L7.8 3.5L7.8 1.7L10.2 1.7L10.2 3.5L11.28 3.5L12.04 4.26L13.31 2.99L15.01 4.69L13.74 5.96L14.5 6.72L14.5 7.8L16.3 7.8L16.3 10.2L14.5 10.2L14.5 11.28L13.74 12.04L15.01 13.31L13.31 15.01L12.04 13.74L11.28 14.5L10.2 14.5L10.2 16.3L7.8 16.3L7.8 14.5L6.72 14.5L5.96 13.74L4.69 15.01L2.99 13.31L4.26 12.04L3.5 11.28L3.5 10.2L1.7 10.2L1.7 7.8L3.5 7.8L3.5 6.72L4.26 5.96L2.99 4.69L4.69 2.99L5.96 4.26Z"
        />
        <path
          strokeLinejoin="miter"
          d="M8.17 7L9.83 7L11 8.17L11 9.83L9.83 11L8.17 11L7 9.83L7 8.17Z"
        />
      </>
    ),
  };

  return (
    <svg
      viewBox="0 0 18 18"
      aria-hidden="true"
      className={`${sizeClass} shrink-0 transition-[color,transform] duration-300 ease-[var(--ease-spring)] group-hover:scale-110 ${
        active ? "text-accent" : "text-ink-subtle group-hover:text-ink-muted"
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}
