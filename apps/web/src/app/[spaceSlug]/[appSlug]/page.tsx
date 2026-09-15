import Link from "next/link";
import { notFound } from "next/navigation";
import { TopBar } from "@/components/top-bar";
import { NotFoundError, requireAppAccess } from "@/lib/authz";
import { canManageApp } from "@cira/core";
import { loadAccess } from "@/lib/access-actions";
import { appHoldsKey, deploymentHistory } from "@/lib/queries";
import { reconcileDeployment } from "@/lib/deployment-sync";
import { DeploymentHistory } from "@/components/deployment-history";
import { AccessPanel } from "@/components/access-panel";
import { latestDeployment } from "@/lib/queries";
import { appColor, appInitial } from "@/lib/app-color";
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
    const [rawDeployment, holdsKey, history] = await Promise.all([
      latestDeployment(app.id),
      appHoldsKey(app.id),
      deploymentHistory(app.id),
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
      <>
        <TopBar spaceSlug={spaceSlug} />

        <main className="animate-fade-in mx-auto w-full max-w-3xl px-6 py-10">
          <Link
            href={`/${spaceSlug}`}
            className="group -mx-2 -my-1.5 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] text-ink-muted transition-colors hover:text-ink"
          >
            <span
              aria-hidden="true"
              className="transition-transform duration-200 group-hover:-translate-x-0.5"
            >
              &larr;
            </span>
            {space.name}
          </Link>

          <div className="mt-6 flex items-start gap-4">
            <span
              aria-hidden="true"
              style={{ backgroundColor: color.bg, color: color.fg }}
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[15px] text-[22px] font-semibold"
            >
              {app.icon ?? appInitial(app.name)}
            </span>

            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-semibold tracking-tight text-ink">
                {app.name}
              </h1>
              {app.description !== null && app.description !== "" ? (
                <p className="mt-1 text-[15px] text-ink-muted">{app.description}</p>
              ) : null}
            </div>
          </div>

          <div className="mt-7">
            {resolved.openUrl !== null ? (
              <a
                href={`/${spaceSlug}/${appSlug}/open`}
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-[15px] font-medium text-white shadow-[0_4px_14px_-4px_rgba(91,75,214,0.6)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-accent-hover"
              >
                Open
                <span aria-hidden="true">&rarr;</span>
              </a>
            ) : (
              <p className="rounded-xl border border-border bg-surface px-5 py-4 text-[14px] text-ink-muted">
                {resolved.blockedReason}
              </p>
            )}
          </div>

          <dl className="mt-9 grid grid-cols-[repeat(auto-fit,minmax(min(100%,160px),1fr))] gap-px overflow-hidden rounded-[var(--radius-card)] border border-border bg-border">
            <Fact label="Status">
              <StatusValue state={resolved.state} label={resolved.label} />
            </Fact>
            <Fact label="Last deployed">
              {deployment === null ? "Never" : relativeTime(deployment.createdAt)}
            </Fact>
            <Fact label="Provider">
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
        </main>
      </>
    );
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface px-5 py-4">
      <dt className="text-[11px] font-medium tracking-wide text-ink-subtle uppercase">
        {label}
      </dt>
      <dd className="mt-1.5 text-[14px] text-ink">{children}</dd>
    </div>
  );
}

const STATUS_DOT: Record<string, string> = {
  live: "bg-live",
  deploying: "bg-pending animate-breathe",
  failed: "bg-failed",
  "never-deployed": "bg-ink-subtle",
};

function StatusValue({ state, label }: { state: string; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[state] ?? "bg-ink-subtle"}`}
      />
      {label}
    </span>
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
