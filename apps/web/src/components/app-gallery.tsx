"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { App } from "@cira/core";
import { AppCard } from "./app-card";

/**
 * The gallery is the product's front door, so it behaves like a launcher
 * rather than a page with a filter box: a shortcut from anywhere, arrows to
 * move, Enter to open. Someone who knows what they want should never need the
 * mouse, and someone who does not should never notice any of it.
 */
export function AppGallery({ apps, spaceSlug }: { apps: App[]; spaceSlug: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [navigating, setNavigating] = useState(false);
  const [shortcutHint, setShortcutHint] = useState<string | null>(null);
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

  // Platform is only known in the browser, so the hint appears after mount
  // rather than risking a server/client mismatch on first paint.
  useEffect(() => {
    const mac = /mac|iphone|ipad/i.test(navigator.userAgent);
    setShortcutHint(mac ? "⌘K" : "Ctrl K");
  }, []);

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

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }

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
    <div className="flex flex-col gap-5">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-4 h-[18px] w-[18px] -translate-y-1/2 text-ink-subtle" />

        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Search apps..."
          aria-label="Search apps"
          autoComplete="off"
          className="w-full rounded-xl bg-surface py-3.5 pr-20 pl-11 text-[15px] text-ink shadow-[var(--shadow-rest)] transition-all duration-200 outline-none placeholder:text-ink-subtle focus:shadow-[0_0_0_2px_var(--color-accent)] [&::-webkit-search-cancel-button]:hidden"
        />

        {shortcutHint !== null && query === "" ? (
          <kbd className="animate-fade-in pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 rounded-md bg-sunken px-2 py-1 font-mono text-[10px] font-medium tracking-wide text-ink-subtle">
            {shortcutHint}
          </kbd>
        ) : null}
      </div>

      {matches.length === 0 ? (
        <div className="animate-fade-in flex flex-col items-center gap-1 py-14 text-center">
          <p className="text-[15px] text-ink">
            No apps match &ldquo;{query.trim()}&rdquo;
          </p>
          <p className="text-[13px] text-ink-muted">
            Try a different word, or press Escape to clear.
          </p>
        </div>
      ) : (
        <ul
          className={`grid auto-rows-fr grid-cols-2 gap-3 transition-opacity duration-150 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 ${
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
