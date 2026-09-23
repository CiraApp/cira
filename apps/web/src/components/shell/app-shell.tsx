import type { Route } from "next";
import { roleAtLeast, type Role, type Space } from "@cira/core";
import { AmbientField } from "@/components/ambient-field";
import { AskButton } from "@/components/ask/ask-button";
import { CommandPalette } from "@/components/command-palette";
import { SidebarNav, type NavItem } from "./sidebar-nav";
import { SpaceMenu } from "./space-menu";
import { MobileNav } from "./mobile-nav";
import { Wordmark } from "./wordmark";
import { HeaderControls } from "./header-controls";
import { HeaderTitle } from "./header-title";
import { RouteProgress } from "./route-progress";
import { SettingsLink } from "./settings-link";
import { ConnectAssistant } from "@/components/connect-assistant";
import { listAssistantTokens } from "@/lib/assistant-actions";
import { ThemePicker } from "@/components/theme/theme-picker";
import { Announcer } from "@/components/ui/announcer";

/**
 * The product shell: a fixed spine on the left, a thin header, and one
 * scrolling column of work.
 *
 * The spine is ordered by how often you reach for something. The company you
 * are in takes the top, level with the header, because it scopes everything
 * under it. The work - Settings included - sits in the middle, because a
 * destination you cannot find in the list is a destination you hunt for. The
 * foot belongs to the brand, with Settings as a glyph at the far end of it.
 *
 * The sidebar is the only place navigation lives, so the header stays free for
 * what belongs to the current view. On a phone the spine folds into a sheet
 * rather than collapsing to icons, because a row of unlabelled glyphs is a
 * quiz.
 *
 * Everything atmospheric is mounted here once - the field, the palette, the
 * route bar - so a page never has to think about any of it.
 */
export async function AppShell({
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

  // Whoever the invoice reaches should not have to hunt for it, and everyone
  // else should not be shown a page about money they cannot act on. The role
  // is already here, in the list of spaces this person is in.
  const role = spaces.find((space) => space.slug === spaceSlug)?.role;
  if (role !== undefined && roleAtLeast(role, "admin")) {
    items.push({
      label: "Billing",
      href: `/${spaceSlug}/~/usage` as Route,
      icon: "billing",
    });
  }

  // Out of the list and onto the foot, as a glyph beside the brand. It stays in
  // the palette, because that is where you look for a place by name.
  const settings: NavItem = {
    label: "Settings",
    href: `/${spaceSlug}/~/settings` as Route,
    icon: "settings",
  };

  // The record of what admins have changed. Not in the sidebar - it is read
  // when something is being looked into, not every day - but reachable by
  // name in the palette, and linked from Settings.
  const changes: NavItem[] =
    role !== undefined && roleAtLeast(role, "admin")
      ? [{ label: "Changes", href: `/${spaceSlug}/~/changes` as Route, icon: "recent" }]
      : [];

  // Not in the sidebar - it is about you rather than the space - but in the
  // palette, which is where a place is looked for by name.
  const profile: NavItem = {
    label: "Your profile",
    href: `/${spaceSlug}/~/profile` as Route,
    icon: "profile",
  };

  // The card shows the most recent token rather than a count: "connected, and
  // this is the one that has been working" is the useful fact.
  // Only an assistant's own token means an assistant is connected. The CLI's
  // is listed beside them, and counting it said "Assistant connected" to
  // everyone who had only ever run `cira login`.
  const assistant = (await listAssistantTokens()).find(
    (token) => token.scope === "assistant",
  );

  return (
    <div className="flex min-h-dvh">
      {/* First thing a keyboard reaches, and invisible until it does: past the
          sidebar and header, which are the same on every page, to what is not. */}
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-[var(--radius-edge)] focus:bg-raised focus:px-3 focus:py-2 focus:text-[13px] focus:text-ink focus:shadow-[var(--shadow-panel)]"
      >
        Skip to content
      </a>
      <AmbientField />
      <RouteProgress />

      <aside className="sticky top-0 hidden h-dvh w-[236px] shrink-0 flex-col border-r border-line bg-panel/70 backdrop-blur-xl md:flex">
        <div className="flex h-14 shrink-0 items-center border-b border-line px-2.5">
          <div className="min-w-0 flex-1">
            <SpaceMenu spaces={spaces} currentSlug={spaceSlug} />
          </div>
        </div>

        <div className="flex flex-1 flex-col overflow-y-auto p-2.5">
          <SidebarNav items={items} />
          <div className="mt-5">
            <ConnectAssistant connected={assistant ?? null} />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-[3px] border-t border-line p-2.5">
          <div className="flex min-w-0 flex-1 justify-center">
            <Wordmark href={`/${spaceSlug}` as Route} />
          </div>
          <SettingsLink href={settings.href} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-[env(safe-area-inset-top,0px)] z-30 flex h-14 items-center gap-3 border-b border-line bg-base/70 px-4 backdrop-blur-xl sm:px-6">
          <MobileNav
            spaceSlug={spaceSlug}
            spaces={spaces}
            items={items}
            settingsHref={settings.href}
          />

          <HeaderTitle>{title}</HeaderTitle>

          <div className="flex shrink-0 items-center gap-2">
            <ThemePicker />
            {actions}
            <CommandPalette
              spaceSlug={spaceSlug}
              items={[...items, ...changes, settings, profile]}
            />
            <AskButton />
            <HeaderControls spaceSlug={spaceSlug} />
          </div>
        </header>

        <main
          id="content"
          tabIndex={-1}
          className="min-w-0 flex-1 px-4 py-7 outline-none sm:px-6 lg:px-8"
        >
          <div className="mx-auto w-full max-w-[1180px]">{children}</div>
        </main>
        <Announcer />
      </div>
    </div>
  );
}
