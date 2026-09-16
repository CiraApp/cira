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
 *
 * Drawn at the mark's height rather than the nav rows'. In a row a 15px glyph
 * is sized against the label beside it; here it sits alone opposite the brand,
 * and at 15px it read as a smaller thing rather than the other end of a pair.
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
      className="group flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[var(--radius-edge)] transition-colors duration-150 hover:bg-sunken"
    >
      <NavIcon name="settings" active={active} sizeClass="h-[18px] w-[18px]" />
    </Link>
  );
}
