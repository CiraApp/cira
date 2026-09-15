"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { App } from "@cira/core";
import { AppCard } from "./app-card";

/**
 * The gallery is the product's front door, so it behaves like a launcher
 * rather than a page with a filter box: a keystroke to focus, arrows to move,
 * Enter to open. Someone who knows what they want should never need the mouse,
 * and someone who does not should never notice any of it.
 *
 * It owns "/" only. The command palette owns the global shortcut, so pressing
 * it here opens the same launcher it opens everywhere else rather than a
 * second, subtly different one.
 */
export function AppGallery({ apps, spaceSlug }: { apps: App[]; spaceSlug: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [navigating, setNavigating] = useState(false);
  // Focus lives in state, not read from `document` during render: that would
  // break server rendering and would not re-render when focus moves.
  const [focused, setFocused] = useState(false);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return apps;
    return apps.filter((app) =>
      [app.name, app.description ?? ""].some((field) =>
        field.toLowerCase().includes(needle),
      ),
    );
  }, [apps, query]);

  // A stale selection after filtering would open the wrong app on Enter.
  useEffect(() => {
    setSelected(0);
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

      if (matches.length === 0) return;

      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        setSelected((i) => (i + 1) % matches.length);
      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        setSelected((i) => (i - 1 + matches.length) % matches.length);
      } else if (event.key === "Enter" && focused) {
        const app = matches[selected];
        if (app !== undefined) {
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
  }, [matches, selected, query, router, spaceSlug, focused]);

  return (
    <div className="flex flex-col gap-4">
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

        {query === "" ? (
          <kbd className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded-[2px] border border-line bg-sunken px-1.5 py-[3px] font-mono text-[10px] font-medium text-ink-subtle transition-opacity duration-200 group-focus-within:opacity-0">
            /
          </kbd>
        ) : null}
      </div>

      {matches.length === 0 ? (
        <div className="enter-fade flex flex-col items-center gap-1 py-16 text-center">
          <p className="text-[15px] text-ink">
            No apps match &ldquo;{query.trim()}&rdquo;
          </p>
          <p className="text-[13px] text-ink-muted">
            Try a different word, or press Escape to clear.
          </p>
        </div>
      ) : (
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
                selected={focused && index === selected}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
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
