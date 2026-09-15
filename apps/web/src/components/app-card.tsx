import Link from "next/link";
import type { App } from "@cira/core";
import { appColor, appInitial } from "@/lib/app-color";

const STATUS: Record<App["status"], { dot: string; label: string; pulse: boolean }> = {
  live: { dot: "bg-live", label: "Live", pulse: false },
  deploying: { dot: "bg-pending", label: "Deploying", pulse: true },
  failed: { dot: "bg-failed", label: "Failed", pulse: false },
  draft: { dot: "bg-ink-subtle", label: "Draft", pulse: false },
};

/**
 * Deliberately sparse: icon, name, one secondary label. Status appears only
 * when it is not the boring case, so a healthy gallery stays quiet.
 *
 * `selected` is driven by keyboard navigation in the gallery rather than by
 * focus, because the roving selection has to survive the search field keeping
 * focus while someone types and arrows at the same time.
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
  const status = STATUS[app.status];
  const color = appColor(app.id);

  return (
    <Link
      href={`/${spaceSlug}/${app.slug}`}
      data-selected={selected ? "true" : undefined}
      style={
        {
          animationDelay: `${Math.min(index, 12) * 35}ms`,
          "--glow": color.glow,
        } as React.CSSProperties
      }
      className="animate-rise group relative flex h-full min-w-0 flex-col gap-3.5 rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:gap-4 sm:p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[transform,box-shadow,border-color] duration-200 ease-[var(--ease-out-soft)] hover:-translate-y-1 hover:border-transparent hover:shadow-[0_10px_28px_-10px_rgb(var(--glow)/0.42),0_2px_6px_rgba(0,0,0,0.05)] data-[selected]:-translate-y-1 data-[selected]:border-transparent data-[selected]:shadow-[0_0_0_2px_rgb(var(--glow)/0.55),0_10px_28px_-10px_rgb(var(--glow)/0.42)]"
    >
      <span
        aria-hidden="true"
        style={{ backgroundColor: color.bg, color: color.fg }}
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[13px] text-[19px] font-semibold transition-transform duration-200 ease-[var(--ease-out-soft)] group-hover:scale-[1.06]"
      >
        {app.icon ?? appInitial(app.name)}
      </span>

      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="line-clamp-2 text-[15px] leading-snug font-medium text-ink">
          {app.name}
        </span>

        {app.description !== null && app.description !== "" ? (
          <span className="truncate text-[13px] text-ink-muted">{app.description}</span>
        ) : null}
      </span>

      {app.status !== "live" ? (
        <span className="mt-auto flex items-center gap-1.5 pt-1 text-[11px] font-medium text-ink-muted">
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${status.dot} ${
              status.pulse ? "animate-breathe" : ""
            }`}
          />
          {status.label}
        </span>
      ) : null}
    </Link>
  );
}
