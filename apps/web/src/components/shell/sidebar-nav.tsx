"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface NavItem {
  label: string;
  /** Typed so a nav entry cannot point at a route that does not exist. */
  href: Route;
  icon: "apps" | "recent" | "deploy" | "members" | "settings";
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
    <nav ref={listRef} className="relative flex flex-col gap-0.5">
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

function NavIcon({ name, active }: { name: NavItem["icon"]; active: boolean }) {
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
    members: (
      <>
        <circle cx="6.9" cy="6.3" r="2.8" />
        <path d="M2.3 15c0-2.5 2.1-4.2 4.6-4.2s4.6 1.7 4.6 4.2" />
        <path d="M12.2 4.1a2.6 2.6 0 0 1 0 4.8M13.4 10.9c1.4.5 2.4 1.8 2.4 3.5" />
      </>
    ),
    settings: (
      <>
        <circle cx="9" cy="9" r="2.5" />
        <path d="M9 1.9v1.7M9 14.4v1.7M16.1 9h-1.7M3.6 9H1.9M14 4l-1.2 1.2M5.2 12.8 4 14M14 14l-1.2-1.2M5.2 5.2 4 4" />
      </>
    ),
  };

  return (
    <svg
      viewBox="0 0 18 18"
      aria-hidden="true"
      className={`h-[15px] w-[15px] shrink-0 transition-[color,transform] duration-300 ease-[var(--ease-spring)] group-hover:scale-110 ${
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
