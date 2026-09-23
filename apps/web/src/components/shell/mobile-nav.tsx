"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { Role, Space } from "@cira/core";
import { SidebarNav, type NavItem } from "./sidebar-nav";
import { SpaceMenu } from "./space-menu";
import { Wordmark } from "./wordmark";
import type { Route } from "next";
import { SettingsLink } from "./settings-link";

/**
 * The sidebar, folded into a sheet for narrow screens.
 *
 * It closes on navigation, because a menu still covering the page you just
 * asked for is the most common way this pattern goes wrong.
 *
 * A native modal `<dialog>`, like every other overlay: focus moves into the
 * sheet, the page behind is out of reach until it closes, Escape closes it,
 * and focus returns to the button that opened it.
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
  const sheet = useRef<HTMLDialogElement>(null);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    const element = sheet.current;
    if (element === null) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
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

      <dialog
        ref={sheet}
        aria-label="Navigation"
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
        // The backdrop is the dialog itself; the sheet fills what is not.
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
        className="enter-right m-0 mr-auto h-dvh max-h-none w-[264px] max-w-none border-0 border-r border-line bg-panel p-0 text-ink backdrop:bg-black/55 backdrop:backdrop-blur-[2px] md:hidden"
      >
        {open ? (
          <div className="flex h-full flex-col">
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
        ) : null}
      </dialog>
    </>
  );
}
