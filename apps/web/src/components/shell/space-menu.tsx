"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Role, Space } from "@cira/core";

type SpaceOption = Space & { role: Role };

/**
 * Which company you are in, and how to leave for another.
 *
 * Sits at the top of the sidebar rather than in the header, because it scopes
 * everything below it: the nav, the gallery, the search. Putting it anywhere
 * else makes it look like a filter.
 */
export function SpaceMenu({
  spaces,
  currentSlug,
}: {
  spaces: SpaceOption[];
  currentSlug: string;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const current = spaces.find((s) => s.slug === currentSlug);
  const canSwitch = spaces.length > 1;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initial = (current?.name ?? currentSlug).charAt(0).toUpperCase();

  const face = (
    <>
      <span
        aria-hidden="true"
        className="metal metal-edge flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[var(--radius-edge)] border text-[12px] font-bold"
      >
        {initial}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
        {current?.name ?? currentSlug}
      </span>
    </>
  );

  if (!canSwitch) {
    return <div className="flex items-center gap-2.5 px-2.5 py-2">{face}</div>;
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex w-full items-center gap-2.5 rounded-[var(--radius-edge)] px-2.5 py-2 transition-colors duration-150 hover:bg-sunken"
      >
        {face}
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className={`h-3.5 w-3.5 shrink-0 text-ink-subtle transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m4 6.5 4 4 4-4" />
        </svg>
      </button>

      {open ? (
        <div
          role="menu"
          className="enter-scale absolute top-full left-0 z-40 mt-1 w-full min-w-[212px] origin-top overflow-hidden rounded-[var(--radius-edge)] border border-line bg-raised p-1 shadow-[var(--shadow-float)]"
        >
          <p className="eyebrow px-2 pt-1.5 pb-1">Spaces</p>
          {spaces.map((space) => (
            <Link
              key={space.id}
              role="menuitem"
              href={`/${space.slug}`}
              onClick={() => setOpen(false)}
              className="flex items-center justify-between gap-3 rounded-[var(--radius-edge)] px-2 py-1.5 text-[13px] text-ink transition-colors duration-150 hover:bg-sunken"
            >
              <span className="min-w-0 flex-1 truncate">{space.name}</span>
              {space.slug === currentSlug ? (
                <svg
                  viewBox="0 0 16 16"
                  aria-hidden="true"
                  className="h-3.5 w-3.5 shrink-0 text-accent"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m3.5 8.5 3 3 6-7" />
                </svg>
              ) : (
                <span className="shrink-0 text-[11px] text-ink-subtle capitalize">
                  {space.role}
                </span>
              )}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
