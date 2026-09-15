import type { Route } from "next";
import type { Role, Space } from "@cira/core";
import { AmbientField } from "@/components/ambient-field";
import { SidebarNav, type NavItem } from "./sidebar-nav";
import { SpaceMenu } from "./space-menu";
import { MobileNav } from "./mobile-nav";
import { Wordmark } from "./wordmark";
import { HeaderControls } from "./header-controls";

/**
 * The product shell: a fixed spine on the left, a thin header, and one
 * scrolling column of work.
 *
 * The sidebar is the only place navigation lives, so the header stays free for
 * what belongs to the current view. On a phone the spine folds into a sheet
 * rather than collapsing to icons, because a row of unlabelled glyphs is a
 * quiz.
 */
export function AppShell({
  spaceSlug,
  spaces,
  title,
  actions,
  children,
}: {
  spaceSlug: string;
  spaces: Array<Space & { role: Role }>;
  title?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const items: NavItem[] = [
    { label: "Apps", href: `/${spaceSlug}` as Route, icon: "apps" },
    { label: "Recent", href: `/${spaceSlug}/~/recent` as Route, icon: "recent" },
    { label: "Deploy", href: `/${spaceSlug}/~/deploy` as Route, icon: "deploy" },
    { label: "Members", href: `/${spaceSlug}/~/members` as Route, icon: "members" },
    { label: "Settings", href: `/${spaceSlug}/~/settings` as Route, icon: "settings" },
  ];

  return (
    <div className="flex min-h-dvh">
      <AmbientField />

      <aside className="sticky top-0 hidden h-dvh w-[236px] shrink-0 flex-col border-r border-line bg-panel/80 backdrop-blur-xl md:flex">
        <div className="flex h-14 items-center border-b border-line px-4">
          <Wordmark href={`/${spaceSlug}` as Route} />
        </div>

        <div className="p-2.5">
          <SpaceMenu spaces={spaces} currentSlug={spaceSlug} />
        </div>

        <div className="flex-1 overflow-y-auto px-2.5 pb-4">
          <SidebarNav items={items} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-[env(safe-area-inset-top,0px)] z-30 flex h-14 items-center gap-3 border-b border-line bg-base/75 px-4 backdrop-blur-xl sm:px-6">
          <MobileNav spaceSlug={spaceSlug} spaces={spaces} items={items} />

          <div className="min-w-0 flex-1">{title}</div>

          <div className="flex shrink-0 items-center gap-2">
            {actions}
            <HeaderControls />
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-7 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1180px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
