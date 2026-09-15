"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { spaceIndex, type PaletteApp } from "@/lib/palette-actions";
import { Portal } from "./ui/portal";
import { AppIcon } from "./app-icon";
import type { NavItem } from "./shell/sidebar-nav";

interface Command {
  id: string;
  label: string;
  hint: string | null;
  group: "Apps" | "Go to" | "Interface";
  /** Everything the query is matched against, lowercased once up front. */
  haystack: string;
  run: () => void;
  face: React.ReactNode;
}

/**
 * Open anything from the keyboard.
 *
 * Cira is a launcher before it is a console, so the fastest path to an app
 * should not require being on the page that lists them. One shortcut, from
 * anywhere: apps first, then the places in the product, then the two or three
 * things about the interface itself.
 *
 * The index is loaded the first time the palette opens and kept for the rest
 * of the visit. Matching is a plain subsequence test rather than a fuzzy
 * score: with a shelf of company software, "rvd" finding Revenue Dashboard is
 * the whole requirement, and a ranked fuzzy search would mostly be a way to
 * put the wrong app under the cursor.
 */
export function CommandPalette({
  spaceSlug,
  items,
}: {
  spaceSlug: string;
  items: NavItem[];
}) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [apps, setApps] = useState<PaletteApp[] | null>(null);
  const [loading, setLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setCursor(0);
  }, []);

  // The one global shortcut in the product. It toggles, so the same keystroke
  // gets you out of somewhere you did not mean to be.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Loaded once per visit, on first open. A space's shelf does not change
  // often enough to be worth re-fetching every time the palette is summoned.
  useEffect(() => {
    if (!open || apps !== null || loading) return;
    setLoading(true);
    spaceIndex(spaceSlug)
      .then(setApps)
      .catch(() => setApps([]))
      .finally(() => setLoading(false));
  }, [open, apps, loading, spaceSlug]);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const appCommands: Command[] = (apps ?? []).map((app) => ({
      id: `app:${app.id}`,
      label: app.name,
      hint: app.description,
      group: "Apps",
      haystack: `${app.name} ${app.description ?? ""}`.toLowerCase(),
      run: () => router.push(`/${spaceSlug}/${app.slug}`),
      face: <AppIcon appId={app.id} name={app.name} icon={app.icon} size="sm" />,
    }));

    const navCommands: Command[] = items.map((item) => ({
      id: `nav:${item.href}`,
      label: item.label,
      hint: null,
      group: "Go to",
      haystack: item.label.toLowerCase(),
      run: () => router.push(item.href),
      face: <Glyph name="arrow" />,
    }));

    const dark = resolvedTheme === "dark";
    const interfaceCommands: Command[] = [
      {
        id: "theme",
        label: dark ? "Switch to light mode" : "Switch to dark mode",
        hint: null,
        group: "Interface",
        haystack: "theme appearance light dark mode",
        run: () => setTheme(dark ? "light" : "dark"),
        face: <Glyph name={dark ? "sun" : "moon"} />,
      },
    ];

    return [...appCommands, ...navCommands, ...interfaceCommands];
  }, [apps, items, router, spaceSlug, resolvedTheme, setTheme]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return commands;
    return commands.filter((command) => subsequence(needle, command.haystack));
  }, [commands, query]);

  useEffect(() => setCursor(0), [query]);

  // Keep the highlighted row on screen when the arrows walk past the fold.
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>("[data-cursor='true']");
    row?.scrollIntoView({ block: "nearest" });
  }, [cursor, matches]);

  if (!open) return <PaletteTrigger onOpen={() => setOpen(true)} />;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((i) => (matches.length === 0 ? 0 : (i + 1) % matches.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((i) =>
        matches.length === 0 ? 0 : (i - 1 + matches.length) % matches.length,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = matches[cursor];
      if (command !== undefined) {
        close();
        command.run();
      }
    }
  };

  // Rendered as one flat list with headings in it, so arrow keys walk straight
  // through every result and the index the cursor holds is the index shown.
  let group: Command["group"] | null = null;

  return (
    <>
      <PaletteTrigger onOpen={() => setOpen(true)} />

      <Portal>
        <div
          className="enter-fade fixed inset-0 z-50 flex items-start justify-center bg-sunken/70 px-4 pt-[14vh] backdrop-blur-[3px]"
          onMouseDown={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={onKeyDown}
            className="enter-pop flex w-full max-w-[560px] flex-col overflow-hidden rounded-[var(--radius-edge)] border border-line-strong bg-raised shadow-[var(--shadow-panel)]"
          >
            <div className="flex items-center gap-2.5 border-b border-line px-3.5">
              <Glyph name="search" className="h-4 w-4 shrink-0 text-ink-subtle" />
              <input
                ref={inputRef}
                name="command-search"
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search apps and actions..."
                aria-label="Search apps and actions"
                className="min-w-0 flex-1 bg-transparent py-3.5 text-[14px] text-ink outline-none placeholder:text-ink-subtle"
              />
              <kbd className="shrink-0 rounded-[2px] border border-line bg-sunken px-1.5 py-[3px] font-mono text-[10px] font-medium text-ink-subtle">
                Esc
              </kbd>
            </div>

            <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-1.5">
              {loading && apps === null ? (
                <p className="px-2.5 py-8 text-center text-[13px] text-ink-subtle">
                  Reading the shelf...
                </p>
              ) : matches.length === 0 ? (
                <p className="px-2.5 py-8 text-center text-[13px] text-ink-muted">
                  Nothing matches &ldquo;{query.trim()}&rdquo;
                </p>
              ) : (
                matches.map((command, index) => {
                  const heading = command.group === group ? null : command.group;
                  group = command.group;

                  return (
                    <div key={command.id}>
                      {heading !== null ? (
                        <p className="eyebrow px-2.5 pt-3 pb-1.5 first:pt-1">{heading}</p>
                      ) : null}

                      <button
                        type="button"
                        data-cursor={index === cursor ? "true" : undefined}
                        onMouseMove={() => setCursor(index)}
                        onClick={() => {
                          close();
                          command.run();
                        }}
                        className="group/row flex w-full items-center gap-2.5 rounded-[var(--radius-edge)] px-2.5 py-2 text-left transition-colors duration-100 data-[cursor]:bg-[color-mix(in_oklab,var(--color-ink)_9%,transparent)]"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center">
                          {command.face}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] text-ink">
                            {command.label}
                          </span>
                          {command.hint !== null && command.hint !== "" ? (
                            <span className="block truncate text-[11.5px] text-ink-subtle">
                              {command.hint}
                            </span>
                          ) : null}
                        </span>
                        <span
                          aria-hidden="true"
                          className="shrink-0 text-[11px] font-medium text-accent opacity-0 transition-opacity duration-150 group-data-[cursor]/row:opacity-100"
                        >
                          &crarr;
                        </span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex items-center gap-4 border-t border-line bg-panel px-3.5 py-2 text-[11px] text-ink-subtle">
              <span className="flex items-center gap-1.5">
                <Key>&uarr;</Key>
                <Key>&darr;</Key>
                to move
              </span>
              <span className="flex items-center gap-1.5">
                <Key>&crarr;</Key>
                to open
              </span>
            </div>
          </div>
        </div>
      </Portal>
    </>
  );
}

/**
 * The palette's own affordance in the header.
 *
 * A shortcut nobody can see is a shortcut nobody uses, and this is also the
 * only way in on a touch screen, where there is no key to press.
 */
function PaletteTrigger({ onOpen }: { onOpen: () => void }) {
  const [hint, setHint] = useState<string | null>(null);

  // The platform is only known in the browser, so the key cap appears after
  // mount rather than risking a mismatch on first paint.
  useEffect(() => {
    setHint(/mac|iphone|ipad/i.test(navigator.userAgent) ? "⌘K" : "Ctrl K");
  }, []);

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Search apps and actions"
      className="group flex h-[30px] items-center gap-2 rounded-[var(--radius-edge)] border border-line bg-surface pr-1.5 pl-2.5 text-[12.5px] text-ink-subtle transition-[color,border-color,background-color] duration-150 hover:border-line-strong hover:text-ink-muted"
    >
      <Glyph name="search" className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">Search</span>
      {hint !== null ? (
        <kbd className="enter-fade hidden rounded-[2px] border border-line bg-sunken px-1.5 py-[2px] font-mono text-[10px] font-medium sm:inline">
          {hint}
        </kbd>
      ) : null}
    </button>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-[2px] border border-line bg-sunken px-1 font-mono text-[10px]">
      {children}
    </kbd>
  );
}

/**
 * True when every character of `needle` appears in `haystack`, in order.
 * "rvd" matches "revenue dashboard"; "dvr" does not.
 */
function subsequence(needle: string, haystack: string): boolean {
  let at = 0;
  for (const character of needle) {
    if (character === " ") continue;
    at = haystack.indexOf(character, at);
    if (at === -1) return false;
    at += 1;
  }
  return true;
}

function Glyph({ name, className }: { name: string; className?: string }) {
  const paths: Record<string, React.ReactNode> = {
    search: (
      <>
        <circle cx="9" cy="9" r="5.5" />
        <path d="m13.5 13.5 3 3" />
      </>
    ),
    arrow: <path d="M4 10h12M11.5 5.5 16 10l-4.5 4.5" />,
    sun: (
      <>
        <circle cx="10" cy="10" r="3.4" />
        <path d="M10 2.6v1.8M10 15.6v1.8M17.4 10h-1.8M4.4 10H2.6M15.2 4.8l-1.3 1.3M6.1 13.9l-1.3 1.3M15.2 15.2l-1.3-1.3M6.1 6.1 4.8 4.8" />
      </>
    ),
    moon: <path d="M16.2 11.9A7 7 0 0 1 8.1 3.8a7 7 0 1 0 8.1 8.1Z" />,
  };

  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={className ?? "h-4 w-4 text-ink-subtle"}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}
