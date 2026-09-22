import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { PageTitle } from "@/components/shell/page-title";
import { AppIcon } from "@/components/app-icon";
import { CapabilityConsole } from "@/components/capability-console";
import { listMySpaces, NotFoundError, requireAppAccess } from "@/lib/authz";
import { listConsoleCapabilities } from "@/lib/capabilities";
import { appSlugMovedTo, latestDeployment } from "@/lib/queries";

/**
 * The capability console: every capability an app has, each a form to run.
 *
 * Reachable by anyone who may open the app, because a capability is something
 * the app does and the right to use one is the right to use the app - the
 * same rule an agent is held to. For an app with no web page this is its front
 * door: the Open button on its page leads here.
 *
 * Nothing runs on arrival. A capability named in the address is selected, and
 * waits for someone to press Run.
 */
export default async function ConsolePage({
  params,
  searchParams,
}: {
  params: Promise<{ spaceSlug: string; appSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { spaceSlug, appSlug } = await params;
  const query = await searchParams;
  const named = typeof query["capability"] === "string" ? query["capability"] : null;

  try {
    const ctx = await requireAppAccess(spaceSlug, appSlug);
    const { app, space } = ctx;
    const [capabilities, spaces, deployment] = await Promise.all([
      listConsoleCapabilities(app.id),
      listMySpaces(),
      latestDeployment(app.id),
    ]);

    return (
      <AppShell
        spaceSlug={spaceSlug}
        spaces={spaces}
        title={<PageTitle title={`${app.name} console`} detail={space.name} />}
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
                Run what it does, straight from a form. Writes show you exactly what they
                send before they run.
              </p>
            </div>
          </header>

          <div className="enter-up mt-7">
            {capabilities.length === 0 ? (
              <div className="rounded-[var(--radius-edge)] border border-line bg-surface px-4 py-4">
                <p className="text-[13px] text-ink">There is nothing here to run yet.</p>
                <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
                  Cira finds what an app can do by reading its code when it is deployed.
                  The{" "}
                  <Link
                    href={`/${spaceSlug}/${appSlug}`}
                    className="text-ink underline underline-offset-2 transition-colors duration-150 hover:text-ink-muted"
                  >
                    app&apos;s page
                  </Link>{" "}
                  says where that stands.
                </p>
              </div>
            ) : (
              <CapabilityConsole
                entries={capabilities.map((c) => ({
                  id: c.id,
                  name: c.name,
                  description: c.description,
                  method: c.target.method,
                  path: c.target.path,
                  risk: c.risk,
                  reach: c.reach,
                  enabled: c.enabled,
                  inputSchema: c.inputSchema,
                  example: c.example,
                }))}
                appName={app.name}
                running={deployment?.status === "live"}
                initial={named}
                logsHref={ctx.manages ? `/${spaceSlug}/${appSlug}/logs` : null}
              />
            )}
          </div>
        </div>
      </AppShell>
    );
  } catch (error) {
    if (error instanceof NotFoundError) {
      const moved = await appSlugMovedTo(spaceSlug, appSlug);
      if (moved !== null) redirect(`/${spaceSlug}/${moved}/console`);
      notFound();
    }
    throw error;
  }
}
