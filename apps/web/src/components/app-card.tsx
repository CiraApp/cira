import Link from "next/link";
import type { App } from "@cira/core";
import { appColor } from "@/lib/app-color";
import { AppIcon } from "./app-icon";
import { StatusDot } from "./status-dot";

/**
 * An app on the shelf.
 *
 * Square-shouldered and hairline-bordered rather than a soft floating card:
 * the grid should read as a set of drawn cells. On hover the cell lifts a
 * hair, its border takes the app's own colour, and a faint wash of that colour
 * rises from the bottom, so the thing that reacts is unmistakably this app and
 * not a generic surface.
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

  return (
    <Link
      href={`/${spaceSlug}/${app.slug}`}
      data-selected={selected ? "true" : undefined}
      style={
        {
          animationDelay: `${Math.min(index, 16) * 28}ms`,
          "--glow": color.glow,
        } as React.CSSProperties
      }
      className="enter-up group relative isolate flex h-full min-w-0 flex-col gap-3 overflow-hidden rounded-[var(--radius-edge)] border border-line bg-surface p-3.5 pb-8 transition-[transform,border-color,box-shadow] duration-200 ease-[var(--ease-settle)] outline-none hover:-translate-y-[3px] hover:border-[var(--gold-border)] hover:shadow-[0_0_0_1px_var(--gold-border),0_16px_34px_-20px_rgb(var(--glow)/0.5)] active:translate-y-0 active:duration-75 data-[selected]:-translate-y-[3px] data-[selected]:border-[var(--gold)] data-[selected]:shadow-[0_0_0_1px_var(--gold),0_16px_34px_-20px_rgb(var(--glow)/0.5)]"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-20 bg-[linear-gradient(to_top,rgb(var(--glow)/0.11),transparent)] opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-data-[selected]:opacity-100"
      />

      {/* Light catching the top lip, which is what makes the edge read as metal. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--gold-highlight),transparent)] opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-data-[selected]:opacity-100"
      />

      <div className="flex items-start justify-between gap-3">
        <span className="transition-transform duration-200 ease-[var(--ease-snap)] group-hover:-translate-y-[1px] group-hover:scale-[1.04]">
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
        className="pointer-events-none absolute right-3.5 bottom-3 flex translate-x-1 items-center gap-1 text-[11px] font-medium text-accent opacity-0 transition-all duration-200 ease-[var(--ease-settle)] group-hover:translate-x-0 group-hover:opacity-100 group-data-[selected]:translate-x-0 group-data-[selected]:opacity-100"
      >
        Open
        <svg
          viewBox="0 0 12 12"
          className="h-3 w-3"
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
