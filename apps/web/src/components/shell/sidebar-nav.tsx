"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  label: string;
  /** Typed so a nav entry cannot point at a route that does not exist. */
  href: Route;
  icon: "apps" | "recent" | "deploy" | "members" | "settings";
}

/**
 * The spine of the product.
 *
 * The active item is marked by a hairline rail rather than a filled pill: a
 * rail reads as position within a structure, which is what a sidebar is for,
 * and it keeps the single accent doing a single job.
 */
export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active =
          pathname === item.href ||
          (item.href.split("/").length > 2 && pathname.startsWith(`${item.href}/`));

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`group relative flex items-center gap-2.5 rounded-[var(--radius-edge)] px-2.5 py-[7px] text-[13px] font-medium transition-colors duration-150 ${
              active
                ? "bg-sunken text-ink"
                : "text-ink-muted hover:bg-sunken/60 hover:text-ink"
            }`}
          >
            <span
              aria-hidden="true"
              className={`absolute top-1/2 left-0 h-[15px] w-[2px] -translate-y-1/2 bg-accent transition-transform duration-200 ease-[var(--ease-snap)] ${
                active ? "scale-y-100" : "scale-y-0"
              }`}
            />
            <NavIcon name={item.icon} active={active} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
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
      className={`h-[15px] w-[15px] shrink-0 transition-colors duration-150 ${
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
