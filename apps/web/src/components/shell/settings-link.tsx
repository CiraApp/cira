"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavIcon } from "./sidebar-nav";

/**
 * Settings, at the far end of the rule the brand signs.
 *
 * It is a glyph rather than a row because it is not part of the work: the four
 * labelled items above are places you go to do something, and this is where
 * you go when something needs changing. The label lives in the tooltip and the
 * accessible name, so nothing is lost to anyone who cannot see the shape.
 */
export function SettingsLink({ href }: { href: Route }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-label="Settings"
      title="Settings"
      aria-current={active ? "page" : undefined}
      className="group flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[var(--radius-edge)] transition-colors duration-150 hover:bg-sunken"
    >
      <NavIcon name="settings" active={active} />
    </Link>
  );
}
