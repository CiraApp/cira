"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Role, Space } from "@cira/core";

type SpaceOption = Space & { role: Role };

/**
 * The space name is both the page heading and the way to change spaces.
 *
 * Making the heading itself the control keeps a second navigation element off
 * the screen. With only one space there is nothing to switch to, so it renders
 * as a plain heading rather than a control that does nothing.
 */
export function SpaceSwitcher({
  spaces,
  currentSlug,
}: {
  spaces: SpaceOption[];
  currentSlug: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const current = spaces.find((s) => s.slug === currentSlug);
  const others = spaces.filter((s) => s.slug !== currentSlug);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (others.length === 0) {
    return (
      <h1 className="text-[28px] font-semibold tracking-tight text-ink">
        {current?.name ?? currentSlug}
      </h1>
    );
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="group -mx-2 flex items-center gap-2 rounded-xl px-2 py-1 transition-colors hover:bg-black/[0.035]"
      >
        <h1 className="text-[28px] font-semibold tracking-tight text-ink">
          {current?.name ?? currentSlug}
        </h1>
        <ChevronDown
          className={`mt-1 h-4 w-4 text-ink-subtle transition-transform duration-200 group-hover:text-ink-muted ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open ? (
        <div
          role="menu"
          className="animate-pop-in absolute top-full left-0 z-20 mt-1 w-64 origin-top-left overflow-hidden rounded-2xl border border-border bg-raised p-1.5 shadow-lg shadow-black/[0.07]"
        >
          <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-ink-subtle uppercase">
            Your spaces
          </p>

          {spaces.map((space) => {
            const isCurrent = space.slug === currentSlug;
            return (
              <Link
                key={space.id}
                role="menuitem"
                href={`/${space.slug}`}
                onClick={() => setOpen(false)}
                className="flex items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-[14px] text-ink transition-colors hover:bg-black/[0.04]"
              >
                <span className="min-w-0 flex-1 truncate">{space.name}</span>
                {isCurrent ? (
                  <Check className="h-4 w-4 shrink-0 text-accent" />
                ) : (
                  <span className="shrink-0 text-[11px] text-ink-subtle capitalize">
                    {space.role}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ChevronDown({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

function Check({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3.5 8.5 3 3 6-7" />
    </svg>
  );
}
