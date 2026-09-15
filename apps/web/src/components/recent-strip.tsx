import Link from "next/link";
import type { App } from "@cira/core";
import { appColor } from "@/lib/app-color";
import { AppIcon } from "./app-icon";

/**
 * What you opened last, across the top of the shelf.
 *
 * A row rather than a second grid: it is a shortcut, not a second library, and
 * giving it the same weight as the gallery would make the page argue with
 * itself about where to look.
 */
export function RecentStrip({ apps, spaceSlug }: { apps: App[]; spaceSlug: string }) {
  if (apps.length === 0) return null;

  return (
    <section className="enter-up flex flex-col gap-2.5">
      <p className="eyebrow">Recent</p>

      <ul className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {apps.map((app, index) => {
          const color = appColor(app.id);
          return (
            <li key={app.id} className="shrink-0">
              <Link
                href={`/${spaceSlug}/${app.slug}`}
                style={
                  {
                    animationDelay: `${index * 26}ms`,
                    "--glow": color.glow,
                  } as React.CSSProperties
                }
                className="enter-up group flex items-center gap-2.5 rounded-[var(--radius-edge)] border border-line bg-surface py-2 pr-3.5 pl-2 transition-[transform,border-color] duration-200 ease-[var(--ease-settle)] hover:-translate-y-[2px] hover:border-[rgb(var(--glow)/0.55)] active:translate-y-0 active:duration-75"
              >
                <AppIcon appId={app.id} name={app.name} icon={app.icon} size="sm" />
                <span className="max-w-[160px] truncate text-[12.5px] font-medium text-ink">
                  {app.name}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
