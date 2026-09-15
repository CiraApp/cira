import Link from "next/link";
import type { App } from "@cira/core";

const STATUS_STYLES: Record<App["status"], { dot: string; label: string }> = {
  live: { dot: "bg-live", label: "Live" },
  deploying: { dot: "bg-pending", label: "Deploying" },
  failed: { dot: "bg-failed", label: "Failed" },
  draft: { dot: "bg-ink-subtle", label: "Draft" },
};

/**
 * Deliberately sparse: icon, name, and one secondary label. Status only earns a
 * place when it is not the boring case, so a healthy gallery stays quiet.
 */
export function AppCard({ app, spaceSlug }: { app: App; spaceSlug: string }) {
  const status = STATUS_STYLES[app.status];

  return (
    <Link
      href={`/${spaceSlug}/${app.slug}`}
      className="group flex min-w-0 flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-xs transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md"
    >
      <span
        aria-hidden="true"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-lg font-semibold text-accent"
      >
        {app.icon ?? app.name.charAt(0).toUpperCase()}
      </span>

      <span className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-[15px] font-medium text-ink">{app.name}</span>

        {app.description !== null && app.description !== "" ? (
          <span className="truncate text-sm text-ink-muted">{app.description}</span>
        ) : null}
      </span>

      {app.status !== "live" ? (
        <span className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
          {status.label}
        </span>
      ) : null}
    </Link>
  );
}
