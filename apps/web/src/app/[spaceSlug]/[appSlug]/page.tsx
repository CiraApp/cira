import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { PageTitle } from "@/components/shell/page-title";
import { listMySpaces } from "@/lib/authz";
import { NotFoundError, requireAppAccess } from "@/lib/authz";
import { canManageApp } from "@cira/core";
import { loadAccess } from "@/lib/access-actions";
import { appHoldsKey, deploymentHistory } from "@/lib/queries";
import { reconcileDeployment } from "@/lib/deployment-sync";
import { DeploymentHistory } from "@/components/deployment-history";
import { AccessPanel } from "@/components/access-panel";
import { AppSettings } from "@/components/app-settings";
import { AppIcon } from "@/components/app-icon";
import { StatusDot } from "@/components/status-dot";
import { latestDeployment } from "@/lib/queries";
import { appColor } from "@/lib/app-color";
import { resolveAppState } from "@/lib/app-state";

export default async function AppPage({
  params,
}: {
  params: Promise<{ spaceSlug: string; appSlug: string }>;
}) {
  const { spaceSlug, appSlug } = await params;

  try {
    const ctx = await requireAppAccess(spaceSlug, appSlug);
    const { app, space } = ctx;
    const [rawDeployment, holdsKey, history, spaces] = await Promise.all([
      latestDeployment(app.id),
      appHoldsKey(app.id),
      deploymentHistory(app.id),
      listMySpaces(),
    ]);

    // Someone is looking at this app right now, so this is exactly when its
    // status has to be true rather than whatever was last written down.
    const deployment =
      rawDeployment === null ? null : await reconcileDeployment(rawDeployment);

    // Only someone who can change access is shown it; for everyone else the
    // page stays the simple "open this app" screen it should be.
    const manages = canManageApp({
      userId: ctx.user.id,
      app,
      memberships: ctx.memberships,
    });
    const access = manages ? await loadAccess(spaceSlug, appSlug) : null;
    const color = appColor(app.id);
    const resolved = resolveAppState(app, deployment, holdsKey);

    return (
      <AppShell
        spaceSlug={spaceSlug}
        spaces={spaces}
        title={<PageTitle title={app.name} detail={space.name} />}
      >
        <div
          className="max-w-3xl"
          style={{ "--glow": color.glow } as React.CSSProperties}
        >
          <Link
            href={`/${spaceSlug}`}
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
            {space.name}
          </Link>

          {/*
            The hero is the one place an app's own colour is allowed to reach
            past its icon: a wide, faint bloom of the hue behind the name, so
            the page is unmistakably this app's page and not a template with
            the name swapped in.
          */}
          <header className="enter-up relative mt-5 overflow-hidden rounded-[var(--radius-edge)] border border-line bg-surface p-6">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -top-24 -left-16 h-64 w-64 rounded-full bg-[radial-gradient(circle,rgb(var(--glow)/0.16),transparent_65%)] blur-xl"
            />

            <div className="relative flex flex-wrap items-start gap-4">
              <AppIcon appId={app.id} name={app.name} icon={app.icon} size="lg" />

              <div className="min-w-0 flex-1">
                <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.02em] text-ink">
                  {app.name}
                </h1>
                {app.description !== null && app.description !== "" ? (
                  <p className="mt-1 text-[13.5px] text-ink-muted">{app.description}</p>
                ) : null}
                <div className="mt-2.5">
                  <StatusDot status={resolved.state} label={resolved.label} />
                </div>
              </div>
            </div>

            <div className="relative mt-6">
              {resolved.openUrl !== null ? (
                <a
                  href={`/${spaceSlug}/${appSlug}/open`}
                  className="btn btn-primary btn-lg group"
                >
                  Open {app.name}
                  <svg
                    viewBox="0 0 12 12"
                    aria-hidden="true"
                    className="h-3 w-3 transition-transform duration-300 ease-[var(--ease-spring)] group-hover:translate-x-0.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2.5 6h7M6.5 3l3 3-3 3" />
                  </svg>
                </a>
              ) : (
                <p className="rounded-[var(--radius-edge)] border border-dashed border-line-strong bg-sunken/50 px-4 py-3 text-[13px] text-ink-muted">
                  {resolved.blockedReason}
                </p>
              )}
            </div>
          </header>

          {/* The hero already states the status in words and in colour, so the
              fact row answers the two things it does not: when, and by whom. */}
          <dl className="enter-up mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] overflow-hidden rounded-[var(--radius-edge)] border border-line bg-surface">
            <Fact label="Last deployed">
              {deployment === null ? "Never" : relativeTime(deployment.createdAt)}
            </Fact>
            {/* Only a provider's own name is capitalised; the fallback is a
                sentence, and "Not Deployed" is not how anyone writes it. */}
            <Fact label="Provider" capitalize={deployment !== null}>
              {deployment === null ? "Not deployed" : deployment.provider}
            </Fact>
          </dl>

          <DeploymentHistory
            spaceSlug={spaceSlug}
            appSlug={appSlug}
            deploys={history.map((d) => ({
              id: d.id,
              status: d.id === deployment?.id ? deployment.status : d.status,
              createdAt: d.createdAt.toISOString(),
              relative: relativeTime(d.createdAt),
            }))}
          />

          {access !== null ? (
            <AccessPanel
              spaceSlug={spaceSlug}
              appSlug={appSlug}
              spaceName={space.name}
              entries={access.entries}
              candidates={access.candidates}
              hasEveryone={access.entries.some((e) => e.kind === "everyone")}
            />
          ) : null}

          {manages ? (
            <AppSettings spaceSlug={spaceSlug} appSlug={appSlug} appName={app.name} />
          ) : null}
        </div>
      </AppShell>
    );
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

/**
 * One cell of the fact row. Separated by its own left hairline rather than by
 * a gap in a coloured parent, so a row that wraps to two lines does not leave
 * a stripe hanging in the empty half.
 */
function Fact({
  label,
  capitalize = false,
  children,
}: {
  label: string;
  /** Only for values that arrive lowercased, like a provider's name. A
      relative time capitalised word by word reads as "2 Hours Ago". */
  capitalize?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="border-l border-line px-4 py-3.5 first:border-l-0">
      <dt className="eyebrow">{label}</dt>
      <dd className={`mt-1.5 text-[13px] text-ink ${capitalize ? "capitalize" : ""}`}>
        {children}
      </dd>
    </div>
  );
}

/** Coarse on purpose: "5 minutes ago" is what the spec asks for, not a timestamp. */
function relativeTime(when: Date): string {
  const seconds = Math.round((Date.now() - when.getTime()) / 1000);
  if (seconds < 60) return "Just now";

  const units: Array<[number, string]> = [
    [60, "minute"],
    [3600, "hour"],
    [86400, "day"],
  ];

  for (let i = units.length - 1; i >= 0; i -= 1) {
    const entry = units[i];
    if (entry === undefined) continue;
    const [size, name] = entry;
    if (seconds >= size) {
      const value = Math.floor(seconds / size);
      return `${value} ${name}${value === 1 ? "" : "s"} ago`;
    }
  }

  return "Just now";
}
