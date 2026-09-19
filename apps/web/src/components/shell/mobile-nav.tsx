"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { Role, Space } from "@cira/core";
import { SidebarNav, type NavItem } from "./sidebar-nav";
import { SpaceMenu } from "./space-menu";
import { Wordmark } from "./wordmark";
import type { Route } from "next";
import { Portal } from "@/components/ui/portal";
import { SettingsLink } from "./settings-link";

/**
 * The sidebar, folded into a sheet for narrow screens.
 *
 * It closes on navigation, because a menu still covering the page you just
 * asked for is the most common way this pattern goes wrong.
 */
export function MobileNav({
  spaceSlug,
  spaces,
  items,
  settingsHref,
}: {
  spaceSlug: string;
  spaces: Array<Space & { role: Role }>;
  items: NavItem[];
  /** Beside the brand at the foot of the sheet, exactly as on the spine. */
  settingsHref: Route;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="-ml-1 flex h-9 w-9 items-center justify-center rounded-[var(--radius-edge)] text-ink-muted transition-colors duration-150 hover:bg-sunken hover:text-ink md:hidden"
      >
        <svg
          viewBox="0 0 18 18"
          aria-hidden="true"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        >
          <path d="M2.5 4.5h13M2.5 9h13M2.5 13.5h13" />
        </svg>
      </button>

      {open ? (
        <Portal>
          <div className="fixed inset-0 z-50 md:hidden">
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setOpen(false)}
              className="enter-fade absolute inset-0 bg-black/55 backdrop-blur-[2px]"
            />

            <div className="enter-right absolute inset-y-0 left-0 flex w-[264px] flex-col border-r border-line bg-panel">
              <div className="flex h-14 shrink-0 items-center border-b border-line px-2.5">
                <div className="min-w-0 flex-1">
                  <SpaceMenu spaces={spaces} currentSlug={spaceSlug} />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2.5">
                <SidebarNav items={items} />
              </div>

              <div className="flex shrink-0 items-center gap-[3px] border-t border-line p-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom,0px))]">
                <div className="flex min-w-0 flex-1 justify-center">
                  <Wordmark href={`/${spaceSlug}` as Route} />
                </div>
                <SettingsLink href={settingsHref} />
              </div>
            </div>
          </div>
        </Portal>
      ) : null}
    </>
  );
}
