"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

/**
 * Light and dark, with the system's own preference as the resting state.
 *
 * Rendered as a placeholder until mounted: the current theme is only known in
 * the browser, and drawing the wrong icon for a frame is worse than drawing
 * none.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={
        mounted ? `Switch to ${isDark ? "light" : "dark"} mode` : "Switch theme"
      }
      className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-subtle transition-colors hover:bg-sunken hover:text-ink-muted"
    >
      {!mounted ? (
        <span className="h-4 w-4" />
      ) : isDark ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </button>
  );
}

function Moon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1Z" />
    </svg>
  );
}

function Sun({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <circle cx="8" cy="8" r="3.1" />
      <path d="M8 1v1.6M8 13.4V15M15 8h-1.6M2.6 8H1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1M12.9 12.9l-1.1-1.1M4.2 4.2 3.1 3.1" />
    </svg>
  );
}
