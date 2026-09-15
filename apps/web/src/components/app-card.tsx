"use client";

import Link, { useLinkStatus } from "next/link";
import type { App } from "@cira/core";
import { appColor } from "@/lib/app-color";
import { AppIcon } from "./app-icon";
import { StatusDot } from "./status-dot";

/**
 * An app on the shelf.
 *
 * Square-shouldered and hairline-bordered rather than a soft floating card:
 * the grid should read as a set of drawn cells. What makes it feel like an
 * object is that it is lit rather than merely highlighted - the border and a
 * wash beneath it brighten only where the pointer is, in the app's own colour,
 * so the thing reacting is unmistakably this app and not a generic surface.
 *
 * The light follows the cursor through two CSS variables written straight onto
 * the element. That runs on every frame of every hover, so it must never go
 * through React state; the component does not re-render while you move across
 * it.
 */
export function AppCard({
  app,
  spaceSlug,
  index = 0,
  selected = false,
}: {
  app: App;
  spaceSlug: string;
  index?: number;
  selected?: boolean;
}) {
  const color = appColor(app.id);

  const light = (event: React.PointerEvent<HTMLAnchorElement>) => {
    const element = event.currentTarget;
    const box = element.getBoundingClientRect();
    element.style.setProperty("--mx", `${event.clientX - box.left}px`);
    element.style.setProperty("--my", `${event.clientY - box.top}px`);
  };

  return (
    <Link
      href={`/${spaceSlug}/${app.slug}`}
      onPointerMove={light}
      data-selected={selected ? "true" : undefined}
      style={
        {
          animationDelay: `${Math.min(index, 16) * 34}ms`,
          "--glow": color.glow,
        } as React.CSSProperties
      }
      className="enter-rise group relative isolate flex h-full min-w-0 flex-col gap-3.5 overflow-hidden rounded-[var(--radius-edge)] border border-line bg-surface p-4 pb-9 transition-[transform,border-color,box-shadow] duration-300 ease-[var(--ease-settle)] outline-none hover:-translate-y-[3px] hover:border-[rgb(var(--glow)/0.3)] hover:shadow-[0_18px_40px_-22px_rgb(var(--glow)/0.65)] active:translate-y-0 active:duration-75 data-[selected]:-translate-y-[3px] data-[selected]:border-[rgb(var(--glow)/0.55)] data-[selected]:shadow-[0_18px_40px_-22px_rgb(var(--glow)/0.65)]"
    >
      <span aria-hidden="true" className="lit-wash" />
      <span aria-hidden="true" className="lit-edge" />

      {/* A wash rising from the foot of the cell, so the card has a base to
          stand on even before the pointer arrives anywhere near it. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-20 bg-[linear-gradient(to_top,rgb(var(--glow)/0.1),transparent)] opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-data-[selected]:opacity-100"
      />

      <OpeningSheen />

      <div className="flex items-start justify-between gap-3">
        <span className="transition-transform duration-300 ease-[var(--ease-spring)] group-hover:-translate-y-[2px] group-hover:scale-[1.06]">
          <AppIcon appId={app.id} name={app.name} icon={app.icon} />
        </span>

        {app.status !== "live" ? <StatusDot status={app.status} compact /> : null}
      </div>

      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="line-clamp-2 text-[14px] leading-snug font-medium text-ink">
          {app.name}
        </span>
        {app.description !== null && app.description !== "" ? (
          <span className="truncate text-[12px] text-ink-subtle">{app.description}</span>
        ) : null}
      </div>

      {/* Absolute, so an affordance that only exists on hover does not pad
          every card with a blank row at rest. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-4 bottom-3.5 flex translate-x-1 items-center gap-1 text-[11px] font-medium text-accent opacity-0 transition-all duration-200 ease-[var(--ease-settle)] group-hover:translate-x-0 group-hover:opacity-100 group-data-[selected]:translate-x-0 group-data-[selected]:opacity-100"
      >
        Open
        <svg
          viewBox="0 0 12 12"
          className="h-3 w-3 transition-transform duration-300 ease-[var(--ease-spring)] group-hover:translate-x-0.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2.5 6h7M6.5 3l3 3-3 3" />
        </svg>
      </span>
    </Link>
  );
}

/**
 * The card you clicked, while its page is still coming.
 *
 * A light sweeping across the cell answers the click on the exact object that
 * was clicked, which a spinner somewhere else in the chrome cannot do. It
 * appears only when the navigation is actually blocked - a prefetched route
 * arrives too fast for this to ever show, which is the point.
 */
function OpeningSheen() {
  const { pending } = useLinkStatus();
  if (!pending) return null;

  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
    >
      <span className="absolute inset-y-0 -left-1/3 w-1/3 animate-[sheen_1.1s_var(--ease-settle)_infinite] bg-[linear-gradient(90deg,transparent,rgb(var(--glow)/0.22),transparent)]" />
    </span>
  );
}
