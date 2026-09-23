import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { PageTitle } from "@/components/shell/page-title";
import { listMySpaces, movedAppFor } from "@/lib/authz";
import { NotFoundError, requireAppAccess } from "@/lib/authz";
import { DEFAULT_LIMITS, describeAppAllowance } from "@cira/core";
import { loadAccess } from "@/lib/access-actions";
import { deploymentHistory, listServicesForApp } from "@/lib/queries";
import { listCapabilitiesForApp } from "@/lib/capabilities";
import { reconcileDeployment } from "@/lib/deployment-sync";
import { DeploymentHistory } from "@/components/deployment-history";
import { RunHistory } from "@/components/run-history";
import { ProcessPanel } from "@/components/process-panel";
import { appHost, appMemory, PLANS } from "@cira/core";
import { assertionsConfigured } from "@/lib/identity-assertion";
import { planForSpace } from "@/lib/plan";
import { processesForPage } from "@/lib/processes";
import { recentRuns } from "@/lib/invocations";
import { AccessPanel } from "@/components/access-panel";
import { AppSettings } from "@/components/app-settings";
import { EnvPanel } from "@/components/env-panel";
import { listEnvVars } from "@/lib/env-vars";
import { appDatabase } from "@/lib/app-databases";
import { appCache } from "@/lib/app-caches";
import { domainTarget, listDomains, refreshDomains } from "@/lib/app-domains";
import { DomainPanel } from "@/components/domain-panel";
import { proxyConfig } from "@/lib/proxy-config";
import { CapabilityPanel } from "@/components/capability-panel";
import { ServicePanel } from "@/components/service-panel";
import { AppIdentity } from "@/components/app-identity";
import { StatusDot } from "@/components/status-dot";
import { LocalTime } from "@/components/local-time";
import { latestDeployment, servingDeployment, webDownSince } from "@/lib/queries";
import { appColor } from "@/lib/app-color";
import { appDoor, consoleHref, resolveAppState } from "@/lib/app-state";
import { appOpenPath } from "@/lib/app-open";
import { learnWebUi } from "@/lib/app-web-ui";
import { appTitle } from "@/lib/page-title";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ spaceSlug: string; appSlug: string }>;
}) {
  const { spaceSlug, appSlug } = await params;
  return appTitle(spaceSlug, appSlug);
}

/**
 * Long because one of this page's actions re-reads an app's whole source and
 * asks a model about it. Next applies a page's limit to the Server Actions it
 * hosts, so it is set here rather than beside the action.
 */
export const maxDuration = 300;

export default async function AppPage({
  params,
}: {
  params: Promise<{ spaceSlug: string; appSlug: string }>;
}) {
  const { spaceSlug, appSlug } = await params;

  try {
    const ctx = await requireAppAccess(spaceSlug, appSlug);
    const { space } = ctx;
    const [rawDeployment, history, spaces, capabilities, services] = await Promise.all([
      latestDeployment(ctx.app.id),
      deploymentHistory(ctx.app.id),
      listMySpaces(),
      listCapabilitiesForApp(ctx.app.id),
      listServicesForApp(ctx.app.id),
    ]);

    // Someone is looking at this app right now, so this is exactly when its
    // status has to be true rather than whatever was last written down.
    const deployment =
      rawDeployment === null ? null : await reconcileDeployment(rawDeployment);
    // Read after reconciling, which is what can turn the newest into it.
    const [serving, downSince] = await Promise.all([
      servingDeployment(ctx.app.id),
      webDownSince(ctx.app.id),
    ]);

    // When each deploy in the list went out, to say what a rollback went back
    // to by the time it was made rather than by an id nobody can read.
    const restoredWhen = new Map(
      history.map((d) => [d.id, relativeTime(d.createdAt)] as const),
    );

    // Whether this app has a front door is settled the same way its deploy
    // status is: by asking, at the moment somebody wants to know. Deploying is
    // not the only chance to find out, and for every app that predates Cira
    // asking at all it was never a chance in the first place.
    const app = await learnWebUi(ctx.app, deployment);

    // Only someone who can change access is shown it; for everyone else the
    // page stays the simple "open this app" screen it should be.
    const manages = ctx.manages;
    const access = manages ? await loadAccess(spaceSlug, appSlug) : null;
    const plan = await planForSpace(ctx.space.id);
    // Only to whoever can manage the app: what it is configured with is part of
    // how it is run, not part of using it.
    const envVars = manages ? await listEnvVars(app.id) : [];
    const databaseOf = manages ? await appDatabase(app.id) : null;
    const cacheOf = manages ? await appCache(app.id) : null;
    // A name someone is waiting on is asked about while they look.
    if (manages) await refreshDomains(new Date(), app.id).catch(() => undefined);
    const domains = manages ? await listDomains(app.id) : [];
    const ownAddress = (() => {
      try {
        return appHost({ appSlug, spaceSlug }, proxyConfig().appsDomain);
      } catch {
        return null;
      }
    })();
    const runs = manages ? await recentRuns(app.id) : null;
    // Whether its workers are running and how its runs went is for anyone
    // who can open the app - troubleshooting "did the report go out?" should
    // not need an admin. How they run, and the switches, stay with managers.
    const processList = await processesForPage(
      app.id,
      deployment?.provider === "cloudrun" ? deployment.providerDeploymentId : null,
      { commands: manages },
    );
    const color = appColor(app.id);
    const resolved = resolveAppState(
      app,
      deployment,
      appOpenPath({ appSlug, spaceSlug }),
      serving,
    );
    // Somewhere to go when the answer is "this app's front door is elsewhere".
    // The setting lives with the app's other details, which is the right place
    // for it and the wrong place to discover it: the person who needs it is
    // the one looking at an app that will not open.
    const offerHomepage =
      manages &&
      (resolved.state === "no-ui" || resolved.state === "unreachable") &&
      // Workers and scheduled runs only: there is no front door to be elsewhere.
      resolved.background !== true &&
      (app.homepageUrl === null || app.homepageUrl === "");
    const { href: door, blockedReason } = appDoor(
      resolved,
      { spaceSlug, appSlug },
      capabilities.length,
    );
    const consolePath = consoleHref({ spaceSlug, appSlug });
    // Said only of a build that is running; one that failed or never shipped
    // already says why nothing answers.
    const outageSince =
      resolved.state === "live" ||
      resolved.state === "no-ui" ||
      resolved.state === "unreachable"
        ? downSince
        : null;

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

            {/* The identity block owns the icon, because while editing the icon
                is the control that changes the picture. */}
            <div className="relative flex flex-wrap items-start gap-4">
              <AppIdentity
                spaceSlug={spaceSlug}
                appSlug={appSlug}
                appId={app.id}
                name={app.name}
                description={app.description}
                icon={app.icon}
                image={app.image}
                canManage={manages}
              >
                <div className="mt-2.5">
                  <StatusDot
                    status={outageSince === null ? resolved.state : "failed"}
                    label={outageSince === null ? resolved.label : "Not answering"}
                  />
                </div>
              </AppIdentity>
            </div>

            <div className="relative mt-6">
              {door !== null ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
                  <a
                    href={door}
                    rel={resolved.external ? "noreferrer" : undefined}
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
                  {door === consolePath ? (
                    <p className="text-[12.5px] text-ink-muted">
                      Not a website, so it opens into its console.
                      {offerHomepage ? (
                        <>
                          {" "}
                          <a
                            href="#settings"
                            className="text-ink underline underline-offset-2 transition-colors duration-150 hover:text-ink-muted"
                          >
                            Opens somewhere else?
                          </a>
                        </>
                      ) : null}
                    </p>
                  ) : null}
                </div>
              ) : (
                /*
                  Dashed when a door is missing, solid when there was never
                  meant to be one. A dashed outline reads as a placeholder -
                  something belongs here and has not arrived - which is exactly
                  right for an app mid-deploy or one that failed, and exactly
                  wrong for a service with no web page and nothing to run.
                  Nothing is late there; there is simply nothing to open.
                */
                <p
                  className={`rounded-[var(--radius-edge)] border bg-sunken/50 px-4 py-3 text-[13px] text-ink-muted ${
                    resolved.state === "no-ui"
                      ? "border-line"
                      : "border-dashed border-line-strong"
                  }`}
                >
                  {blockedReason}
                  {offerHomepage ? (
                    <>
                      {" "}
                      <a
                        href="#settings"
                        className="text-ink underline underline-offset-2 transition-colors duration-150 hover:text-ink-muted"
                      >
                        Opens somewhere else?
                      </a>
                    </>
                  ) : null}
                </p>
              )}
              {outageSince === null ? null : (
                <p className="mt-3.5 flex items-baseline gap-2 text-[12.5px] text-ink-muted">
                  <span
                    aria-hidden="true"
                    className="relative top-[-1px] h-[6px] w-[6px] shrink-0 rounded-full bg-failed"
                  />
                  <span>
                    <span className="text-failed">Not answering</span> since{" "}
                    <LocalTime at={outageSince} />: Cira&rsquo;s checks get a server error
                    or no reply.
                    {manages ? (
                      <>
                        {" "}
                        <a
                          href={`/${spaceSlug}/${appSlug}/logs`}
                          className="text-ink underline underline-offset-2 transition-colors duration-150 hover:text-ink-muted"
                        >
                          Its logs say why
                        </a>
                      </>
                    ) : null}
                  </span>
                </p>
              )}
              {resolved.notice === undefined ? null : (
                <p
                  className={`${outageSince === null ? "mt-3.5" : "mt-1.5"} flex items-baseline gap-2 text-[12.5px] text-ink-muted`}
                >
                  <span
                    aria-hidden="true"
                    className={`relative top-[-1px] h-[6px] w-[6px] shrink-0 rounded-full ${
                      resolved.notice.kind === "failed" ? "bg-failed" : "bg-pending"
                    }`}
                  />
                  <span>
                    {resolved.notice.text}{" "}
                    <a
                      href="#deploys"
                      className="text-ink underline underline-offset-2 transition-colors duration-150 hover:text-ink-muted"
                    >
                      {resolved.notice.kind === "failed" ? "See why" : "Follow it"}
                    </a>
                  </span>
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
            <Fact label="Provider">
              {deployment === null ? "Not deployed" : providerName(deployment.provider)}
            </Fact>
            {/* What Cloud Run gives it, from the same record the provider
                applies, so this cannot claim more room than the app has. */}
            <Fact label="Capacity">
              {describeAppAllowance(
                DEFAULT_LIMITS,
                services.length > 1,
                appMemory(app, services.length > 1),
              )}
            </Fact>
          </dl>

          <ServicePanel services={services} />

          <CapabilityPanel
            capabilities={capabilities}
            canManage={manages}
            analyzed={app.capabilitiesAnalyzedAt !== null}
            // From the deployment, not from whether a browser could open it.
            // An app with no web address is still running and its code can
            // still be read; asking the openability question here would have
            // withheld the button from exactly the headless apps that are
            // most likely to have interesting capabilities.
            running={deployment?.status === "live"}
            spaceSlug={spaceSlug}
            appSlug={appSlug}
            consoleHref={consolePath}
            tellsWhoIsCalling={app.tellsWhoIsCalling}
          />

          <ProcessPanel
            processes={processList}
            spaceSlug={spaceSlug}
            appSlug={appSlug}
            canManage={manages}
            logsHref={manages ? `/${spaceSlug}/${appSlug}/logs` : null}
            servesWeb={deployment?.servesWeb ?? true}
            workerPrice={{
              monthly: PLANS.team.workerMonthly,
              included: plan.includedWorkers,
            }}
          />

          {/* Only where capabilities can be run: an app that is only workers
              and scheduled runs would otherwise show an empty list of a kind
              of run it can never have, right under its own runs. */}
          {runs !== null && (capabilities.length > 0 || runs.length > 0) ? (
            <RunHistory runs={runs} />
          ) : null}

          <DeploymentHistory
            spaceSlug={spaceSlug}
            appSlug={appSlug}
            logsHref={manages ? `/${spaceSlug}/${appSlug}/logs` : null}
            canManage={manages}
            deploys={history.map((d) => ({
              id: d.id,
              status: d.id === deployment?.id ? deployment.status : d.status,
              createdAt: d.createdAt.toISOString(),
              relative: relativeTime(d.createdAt),
              reason:
                d.id === deployment?.id ? deployment.failureReason : d.failureReason,
              warning: d.id === deployment?.id ? deployment.warning : d.warning,
              // A rollback says which deploy it went back to, so a build that
              // is older than the one above it is explained rather than odd.
              restoredFrom:
                d.restoredFromId === null
                  ? null
                  : (restoredWhen.get(d.restoredFromId) ?? null),
            }))}
          />

          {access !== null ? (
            <AccessPanel
              spaceSlug={spaceSlug}
              appSlug={appSlug}
              spaceName={space.name}
              entries={access.entries}
              implicit={access.implicit}
              candidates={access.candidates}
              teamCandidates={access.teamCandidates}
              hasEveryone={access.entries.some((e) => e.kind === "everyone")}
            />
          ) : null}

          {manages && deployment?.servesWeb === true && ownAddress !== null ? (
            <DomainPanel
              spaceSlug={spaceSlug}
              appSlug={appSlug}
              appAddress={ownAddress}
              target={domainTarget()}
              domains={domains}
              limit={DEFAULT_LIMITS.app.domains}
            />
          ) : null}

          {manages ? (
            <EnvPanel vars={envVars} database={databaseOf} cache={cacheOf} />
          ) : null}

          {manages ? (
            <AppSettings
              spaceSlug={spaceSlug}
              appSlug={appSlug}
              appName={app.name}
              appHomepageUrl={app.homepageUrl}
              // Only an app with an address can be kept warm; a worker-only
              // app has nothing for a first request to arrive at.
              keepWarm={deployment?.servesWeb === true ? app.minInstances > 0 : null}
              canKeepWarm={plan.canKeepWarm}
              tellsWhoIsCalling={app.tellsWhoIsCalling}
              canTellWhoIsCalling={assertionsConfigured()}
              // What the company is billed for it, not what it costs Cira.
              warmMonthly={PLANS.team.alwaysOnMonthly}
              memory={
                deployment?.servesWeb === true
                  ? {
                      current: appMemory(app, services.length > 1),
                      fallback: appMemory(
                        { memoryMiB: null, declaredMemoryMiB: app.declaredMemoryMiB },
                        services.length > 1,
                      ),
                      chosen: app.memoryMiB,
                      declared: app.declaredMemoryMiB,
                      choices: DEFAULT_LIMITS.app.memoryChoicesMiB,
                    }
                  : null
              }
            />
          ) : null}
        </div>
      </AppShell>
    );
  } catch (error) {
    if (error instanceof NotFoundError) {
      // Nothing answers on this address now - but something may have, before
      // it was renamed. A link somebody shared months ago should still arrive
      // where they meant it to, rather than at a 404 that tells them the app
      // is gone when it is sitting there under another name.
      const moved = await movedAppFor(spaceSlug, appSlug);
      if (moved !== null) redirect(`/${spaceSlug}/${moved}`);
      notFound();
    }
    throw error;
  }
}

/**
 * One cell of the fact row. Separated by its own left hairline rather than by
 * a gap in a coloured parent, so a row that wraps to two lines does not leave
 * a stripe hanging in the empty half.
 */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-l border-line px-4 py-3.5 first:border-l-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1.5 text-[13px] text-ink">{children}</dd>
    </div>
  );
}

/**
 * A provider as its maker writes it. Capitalising the stored id gave
 * "Cloudrun", which is nobody's name for it.
 */
function providerName(provider: string): string {
  const names: Record<string, string> = {
    cloudrun: "Cloud Run",
    vercel: "Vercel",
    demo: "Demo",
  };
  return names[provider] ?? provider;
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
