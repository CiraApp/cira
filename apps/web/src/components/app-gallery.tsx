"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { App } from "@cira/core";
import { AppCard } from "./app-card";
import { AppIcon } from "./app-icon";
import { useAsk } from "./ask/ask-provider";
import { CiraMark } from "./shell/mark";

/**
 * The gallery is the product's front door, so it behaves like a launcher
 * rather than a page with a filter box: a keystroke to focus, arrows to move,
 * Enter to open. Someone who knows what they want should never need the mouse,
 * and someone who does not should never notice any of it.
 *
 * Its box does two jobs, because two boxes at the top of the page would make
 * everyone stop and decide which one they meant. Typing filters the apps below
 * exactly as it always did. Enter asks Cira; an arrow key first switches to
 * picking an app, and then Enter opens it. People who do not write software
 * are who Ask Cira is for, and they are not going to go looking for it - so it
 * is the first thing on the page, in the place they were already going to type.
 *
 * It owns "/" only. The command palette owns the global shortcut, so pressing
 * it here opens the same launcher it opens everywhere else rather than a
 * second, subtly different one.
 */
export function AppGallery({
  apps,
  spaceSlug,
  firstName,
  between,
}: {
  apps: App[];
  spaceSlug: string;
  /** For the greeting over the box. */
  firstName?: string | undefined;
  /** Shown under the box while nothing is typed: recently opened apps. */
  between?: React.ReactNode;
}) {
  const router = useRouter();
  const ask = useAsk();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  // Whether the arrows have been used to pick an app. Until they have, Enter
  // asks; without Ask Cira there is nothing to ask, so an app is always picked.
  const [picking, setPicking] = useState(false);
  const [navigating, setNavigating] = useState(false);
  // Focus lives in state, not read from `document` during render: that would
  // break server rendering and would not re-render when focus moves.
  const [focused, setFocused] = useState(false);

  const picked = ask === null || picking;

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return apps;
    return apps.filter((app) =>
      [app.name, app.description ?? ""].some((field) =>
        field.toLowerCase().includes(needle),
      ),
    );
  }, [apps, query]);

  // A stale selection after filtering would open the wrong app on Enter, and
  // a new word is a new question until the arrows say otherwise.
  useEffect(() => {
    setSelected(0);
    setPicking(false);
  }, [query]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typingElsewhere =
        target !== null &&
        target !== inputRef.current &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if (typingElsewhere) return;

      // "/" is the muscle memory from every other search box, but it must not
      // hijack the key while someone is typing a path into the field itself.
      if (event.key === "/" && !focused) {
        event.preventDefault();
        inputRef.current?.focus();
        return;
      }

      const moves = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"];
      if (moves.includes(event.key) && matches.length > 0) {
        event.preventDefault();
        // The first arrow only switches to picking, landing on the first app;
        // after that they walk the grid.
        if (!picked) {
          setPicking(true);
          setSelected(0);
          return;
        }
        const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
        setSelected((i) => (i + (forward ? 1 : -1) + matches.length) % matches.length);
      } else if (event.key === "Enter" && focused) {
        if (!picked && ask !== null && query.trim() !== "") {
          event.preventDefault();
          ask.ask(query);
          setQuery("");
          return;
        }
        const app = matches[selected];
        if (picked && app !== undefined) {
          event.preventDefault();
          setNavigating(true);
          router.push(`/${spaceSlug}/${app.slug}`);
        }
      } else if (event.key === "Escape") {
        if (query !== "") {
          setQuery("");
        } else {
          inputRef.current?.blur();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [matches, selected, query, router, spaceSlug, focused, picked, ask]);

  const typed = query.trim() !== "";

  return (
    <div className="flex flex-col gap-7">
      {ask === null ? (
        <div className="group relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-ink-subtle transition-colors duration-200 group-focus-within:text-accent" />
          <input
            ref={inputRef}
            type="search"
            name="app-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Search apps..."
            aria-label="Search apps"
            autoComplete="off"
            className="field py-2.5 pr-12 pl-10 text-[14px] [&::-webkit-search-cancel-button]:hidden"
          />
          {query === "" ? <SlashKey /> : null}
        </div>
      ) : (
        <div className="mx-auto w-full max-w-[760px] pt-2 sm:pt-4">
          <h2 className="text-center text-[22px] font-semibold tracking-[-0.03em] text-ink sm:text-[26px]">
            What do you need
            {firstName !== undefined && firstName !== "" ? `, ${firstName}` : ""}?
          </h2>
          <p className="mt-1.5 text-center text-[13.5px] text-ink-muted sm:text-[14px]">
            Ask for anything your company&rsquo;s apps can tell you, or find an app.
          </p>

          <div className="group relative mt-6 rounded-[6px]">
            <span aria-hidden="true" className="ask-edge" />
            <div className="flex h-[58px] items-center gap-3 rounded-[6px] bg-panel pr-2.5 pl-[18px] shadow-[0_0_0_1px_var(--color-line-strong),0_30px_60px_-34px_rgb(0_0_0/0.7)] transition-shadow duration-200 group-focus-within:shadow-[0_0_0_1px_var(--color-accent),0_0_0_4px_color-mix(in_oklab,var(--color-accent)_14%,transparent),0_30px_60px_-34px_rgb(0_0_0/0.7)]">
              <CiraMark className="h-3 w-auto shrink-0 text-ink" />
              <input
                ref={inputRef}
                type="search"
                name="app-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                placeholder="Ask Cira, or find an app…"
                aria-label="Ask Cira, or find an app"
                autoComplete="off"
                className="min-w-0 flex-1 bg-transparent text-[16px] tracking-[-0.01em] text-ink outline-none placeholder:text-ink-subtle [&::-webkit-search-cancel-button]:hidden"
              />
              {typed && !picked ? (
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    ask.ask(query);
                    setQuery("");
                  }}
                  className="flex h-[38px] shrink-0 items-center gap-2 rounded-[4px] bg-accent px-3.5 text-[13px] font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-hover"
                >
                  Ask
                  <span aria-hidden="true" className="text-[11px] opacity-70">
                    &crarr;
                  </span>
                </button>
              ) : query === "" ? (
                <kbd className="pointer-events-none mr-1 shrink-0 rounded-[2px] border border-line bg-sunken px-1.5 py-[3px] font-mono text-[10px] font-medium text-ink-subtle transition-opacity duration-200 group-focus-within:opacity-0">
                  /
                </kbd>
              ) : null}
            </div>
          </div>

          {typed ? (
            <p className="enter-fade mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[12px] text-ink-subtle">
              {picked ? (
                <span>
                  <Hint>&crarr;</Hint> opens the highlighted app
                </span>
              ) : (
                <span>
                  <Hint>&crarr;</Hint> asks Cira
                </span>
              )}
              {matches.length > 0 ? (
                <span>
                  <Hint>&darr;</Hint> {picked ? "moves between" : "picks from"}{" "}
                  {matches.length}{" "}
                  {matches.length === 1 ? "matching app" : "matching apps"}
                </span>
              ) : null}
            </p>
          ) : ask.suggestions.length > 0 ? (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {ask.suggestions.slice(0, 2).map((suggestion) => (
                <button
                  key={suggestion.question}
                  type="button"
                  onClick={() => ask.ask(suggestion.question)}
                  className="flex h-[30px] max-w-full items-center gap-2 rounded-[var(--radius-edge)] border border-line bg-panel/70 pr-3 pl-1.5 text-[12.5px] text-ink-muted transition-colors duration-150 hover:border-line-strong hover:text-ink"
                >
                  <AppIcon
                    appId={suggestion.app.id}
                    name={suggestion.app.name}
                    size="xs"
                  />
                  <span className="truncate">{suggestion.question}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {query === "" ? between : null}

      {matches.length === 0 ? (
        <div className="enter-fade flex flex-col items-center gap-1 py-16 text-center">
          <p className="text-[15px] text-ink">
            No apps match &ldquo;{query.trim()}&rdquo;
          </p>
          <p className="text-[13px] text-ink-muted">
            {ask === null
              ? "Try a different word, or press Escape to clear."
              : "Press Enter to ask Cira instead, or Escape to clear."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {ask !== null ? <p className="eyebrow">Your apps</p> : null}
          <ul
            className={`grid auto-rows-fr grid-cols-2 gap-3 transition-opacity duration-150 sm:grid-cols-3 lg:grid-cols-4 ${
              navigating ? "opacity-60" : ""
            }`}
          >
            {matches.map((app, index) => (
              <li key={app.id} className="min-w-0">
                <AppCard
                  app={app}
                  spaceSlug={spaceSlug}
                  index={index}
                  selected={focused && picked && index === selected}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mr-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-[2px] border border-line bg-sunken px-1 align-[-3px] text-[10.5px] leading-none text-ink-muted">
      {children}
    </kbd>
  );
}

function SlashKey() {
  return (
    <kbd className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded-[2px] border border-line bg-sunken px-1.5 py-[3px] font-mono text-[10px] font-medium text-ink-subtle transition-opacity duration-200 group-focus-within:opacity-0">
      /
    </kbd>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={className}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <circle cx="9" cy="9" r="5.5" />
      <path d="m13.5 13.5 3 3" />
    </svg>
  );
}
