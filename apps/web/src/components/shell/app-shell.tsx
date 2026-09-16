import type { Route } from "next";
import type { Role, Space } from "@cira/core";
import { AmbientField } from "@/components/ambient-field";
import { CommandPalette } from "@/components/command-palette";
import { SidebarNav, type NavItem } from "./sidebar-nav";
import { SpaceMenu } from "./space-menu";
import { MobileNav } from "./mobile-nav";
import { Wordmark } from "./wordmark";
import { HeaderControls } from "./header-controls";
import { HeaderTitle } from "./header-title";
import { RouteProgress } from "./route-progress";

/**
 * The product shell: a fixed spine on the left, a thin header, and one
 * scrolling column of work.
 *
 * The spine is ordered by how often you reach for something. The company you
 * are in takes the top, level with the header, because it scopes everything
 * under it. The work sits in the middle. Settings and the brand sit at the
 * foot, out of the way of the four things anyone actually clicks.
 *
 * The sidebar is the only place navigation lives, so the header stays free for
 * what belongs to the current view. On a phone the spine folds into a sheet
 * rather than collapsing to icons, because a row of unlabelled glyphs is a
 * quiz.
 *
 * Everything atmospheric is mounted here once - the field, the palette, the
 * route bar - so a page never has to think about any of it.
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
  ];

  // Kept out of the list above and pinned to the foot: it is where you go when
  // something is wrong, not where you go to work.
  const settings: NavItem = {
    label: "Settings",
    href: `/${spaceSlug}/~/settings` as Route,
    icon: "settings",
  };

  return (
    <div className="flex min-h-dvh">
      <AmbientField />
      <RouteProgress />

      <aside className="sticky top-0 hidden h-dvh w-[236px] shrink-0 flex-col border-r border-line bg-panel/70 backdrop-blur-xl md:flex">
        <div className="flex h-14 shrink-0 items-center border-b border-line px-2.5">
          <div className="min-w-0 flex-1">
            <SpaceMenu spaces={spaces} currentSlug={spaceSlug} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2.5">
          <SidebarNav items={items} />
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-line p-2.5">
          <div className="min-w-0 flex-1">
            <SidebarNav items={[settings]} />
          </div>
          <Wordmark href={`/${spaceSlug}` as Route} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-[env(safe-area-inset-top,0px)] z-30 flex h-14 items-center gap-3 border-b border-line bg-base/70 px-4 backdrop-blur-xl sm:px-6">
          <MobileNav
            spaceSlug={spaceSlug}
            spaces={spaces}
            items={items}
            settings={settings}
          />

          <HeaderTitle>{title}</HeaderTitle>

          <div className="flex shrink-0 items-center gap-2">
            {actions}
            <CommandPalette spaceSlug={spaceSlug} items={[...items, settings]} />
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
