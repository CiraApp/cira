"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

/**
 * Light and dark, resting on the system's own preference.
 *
 * Renders an empty slot until mounted: the current theme is only known in the
 * browser, and drawing the wrong icon for a frame is worse than drawing none.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  const dark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={mounted ? `Switch to ${dark ? "light" : "dark"} mode` : "Switch theme"}
      className="flex h-[30px] w-[30px] items-center justify-center rounded-[var(--radius-edge)] text-ink-subtle transition-all duration-150 hover:bg-sunken hover:text-ink active:scale-90"
    >
      {!mounted ? (
        <span className="h-4 w-4" />
      ) : (
        <svg
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
          className="h-4 w-4"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {dark ? (
            <>
              <circle cx="8" cy="8" r="3" />
              <path d="M8 1.2v1.5M8 13.3v1.5M14.8 8h-1.5M2.7 8H1.2M12.8 3.2l-1 1M4.2 11.8l-1 1M12.8 12.8l-1-1M4.2 4.2l-1-1" />
            </>
          ) : (
            <path d="M13.6 9.7A5.9 5.9 0 0 1 6.3 2.4a5.9 5.9 0 1 0 7.3 7.3Z" />
          )}
        </svg>
      )}
    </button>
  );
}
