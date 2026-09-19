import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { PageTitle } from "@/components/shell/page-title";
import { AppIcon } from "@/components/app-icon";
import { RuntimeLogs } from "@/components/runtime-logs";
import {
  ForbiddenError,
  listMySpaces,
  NotFoundError,
  requireAppManage,
} from "@/lib/authz";
import { appSlugMovedTo, latestDeployment } from "@/lib/queries";
import { listProcesses } from "@/lib/processes";
import { fetchRuntimeLogs } from "@/lib/runtime-log-actions";

/**
 * An app's runtime logs: what it printed while it ran, and every request that
 * reached it.
 *
 * Only for people who manage the app, and a 404 for everyone else - the same
 * answer as an app that does not exist, so the page cannot be used to find
 * out which apps do.
 *
 * `?around=` opens on the two minutes around a moment, which is how a failed
 * console run links here; `?capability=` names what ran, for the marker.
 */
export default async function LogsPage({
  params,
  searchParams,
}: {
  params: Promise<{ spaceSlug: string; appSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { spaceSlug, appSlug } = await params;
  const query = await searchParams;
  const aroundParam = typeof query["around"] === "string" ? query["around"] : null;
  const capability =
    typeof query["capability"] === "string" && query["capability"].length <= 120
      ? query["capability"]
      : null;

  const processParam = typeof query["process"] === "string" ? query["process"] : null;

  try {
    const { app, space } = await requireAppManage(spaceSlug, appSlug);
    const [deployment, processList] = await Promise.all([
      latestDeployment(app.id),
      listProcesses(app.id),
    ]);
    // An app with no web process has no web logs; it opens on its first
    // process instead of an empty page.
    const servesWeb = deployment?.servesWeb ?? true;
    const process =
      processList.find((p) => p.name === processParam)?.name ??
      (servesWeb ? null : (processList[0]?.name ?? null));
    const [spaces, initial] = await Promise.all([
      listMySpaces(),
      fetchRuntimeLogs(spaceSlug, appSlug, {
        ...(aroundParam !== null ? { around: aroundParam } : { range: "1h" }),
        ...(process === null ? {} : { process }),
      }),
    ]);
    const sources = [
      ...(servesWeb ? [{ value: null, label: "Web" }] : []),
      ...processList.map((p) => ({
        value: p.name,
        label: `${p.name} (${p.kind === "worker" ? "worker" : "scheduled"})`,
      })),
    ];
    // A moment the server would not use is dropped rather than shown as a
    // marker for a window that was never read.
    const around =
      aroundParam !== null && initial.ok
        ? { at: new Date(aroundParam).toISOString(), label: capability }
        : null;

    return (
      <AppShell
        spaceSlug={spaceSlug}
        spaces={spaces}
        title={<PageTitle title={`${app.name} logs`} detail={space.name} />}
      >
        <div className="max-w-5xl">
          <Link
            href={`/${spaceSlug}/${appSlug}`}
            className="group enter-fade -mx-2 -my-1.5 inline-flex items-center gap-1.5 rounded-[var(--radius-edge)] px-2 py-1.5 text-[12.5px] text-ink-muted transition-colors duration-150 hover:text-ink"
          >
            <svg
              viewBox="0 0 12 12"
              aria-hidden="true"
              className="h-3 w-3 transition-transform duration-300 ease-[var(--ease-spring)] group-hover:-translate-x-0.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9.5 6h-7M5.5 3l-3 3 3 3" />
            </svg>
            {app.name}
          </Link>

          <header className="enter-up mt-5 flex items-center gap-3.5">
            <AppIcon
              appId={app.id}
              name={app.name}
              icon={app.icon}
              image={app.image}
              size="md"
            />
            <div className="min-w-0">
              <h1 className="truncate text-[20px] font-semibold tracking-[-0.02em] text-ink">
                {app.name}
              </h1>
              <p className="mt-0.5 text-[13px] text-ink-muted">
                What it printed while it ran, and every request that reached it. Fetched
                from Google when you look; Cira keeps none of it.
              </p>
            </div>
          </header>

          <div className="enter-up mt-7">
            <RuntimeLogs
              // A different moment is a different page, not a change to this one.
              key={`${process ?? "web"}:${aroundParam ?? "range"}`}
              spaceSlug={spaceSlug}
              appSlug={appSlug}
              initial={initial}
              around={around}
              process={process}
              sources={sources}
            />
          </div>
        </div>
      </AppShell>
    );
  } catch (error) {
    if (error instanceof NotFoundError) {
      const moved = await appSlugMovedTo(spaceSlug, appSlug);
      if (moved !== null) redirect(`/${spaceSlug}/${moved}/logs`);
      notFound();
    }
    if (error instanceof ForbiddenError) notFound();
    throw error;
  }
}
