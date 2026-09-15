import Link from "next/link";
import type { App } from "@cira/core";
import { appColor } from "@/lib/app-color";
import { AppIcon } from "./app-icon";
import { StatusDot } from "./status-dot";

/**
 * Deliberately sparse: icon, name, one secondary label. Status appears only
 * when it is not the boring case, so a healthy shelf stays quiet.
 *
 * Lifting on hover borrows the app's own colour rather than a shared shadow,
 * so the card that rises feels like that app rising and not like a generic
 * surface reacting.
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
          animationDelay: `${Math.min(index, 14) * 32}ms`,
          "--glow": color.glow,
        } as React.CSSProperties
      }
      className="animate-rise group relative flex h-full min-w-0 flex-col gap-3.5 rounded-[var(--radius-card)] bg-surface p-4 shadow-[var(--shadow-rest)] transition-[transform,box-shadow] duration-300 ease-[var(--ease-out-soft)] outline-none hover:-translate-y-1 hover:shadow-[0_14px_32px_-14px_rgb(var(--glow)/0.4),0_0_0_1px_rgb(var(--glow)/0.22)] sm:gap-4 sm:p-5 data-[selected]:-translate-y-1 data-[selected]:shadow-[0_0_0_2px_rgb(var(--glow)/0.6),0_14px_32px_-14px_rgb(var(--glow)/0.4)]"
    >
      <span className="transition-transform duration-300 ease-[var(--ease-out-soft)] group-hover:scale-[1.07]">
        <AppIcon appId={app.id} name={app.name} icon={app.icon} />
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
        <span className="mt-auto pt-1">
          <StatusDot status={app.status} />
        </span>
      ) : null}
    </Link>
  );
}
