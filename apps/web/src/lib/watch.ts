import "server-only";

import { and, count, desc, eq, gt, inArray, notInArray } from "drizzle-orm";
import {
  appOpens,
  appWatch,
  apps,
  db,
  deployments,
  invocations,
  services,
  spaces,
} from "@cira/db";
import {
  effectivePlan,
  nextRuns,
  parseSchedule,
  trialEndsAt,
  type Deployment,
  type ProcessState,
  type StoredProcess,
} from "@cira/core";
import { TERMINAL_STATUSES, deploymentProvider } from "@cira/deploy";
import { ensureStripeSetup, syncQuantities, type StripeSetupReport } from "@/lib/billing";
import { reconcileDeployment } from "@/lib/deployment-sync";
import {
  answeringAgainMessage,
  notAnsweringMessage,
  planEnforcedMessage,
  runFailedMessage,
  trialEndedMessage,
  trialEndingMessage,
} from "@/lib/messages";
import { notifyAdmins, notifyManagers, retryUnsent } from "@/lib/notify";
import { enforcePlan } from "@/lib/plan-enforcement";
import { listProcesses } from "@/lib/processes";
import {
  nextWatch,
  RUN_FAILURE_WINDOW_MS,
  WORKER_MEMORY_WINDOW_MS,
  type Watched,
} from "@/lib/watch-rules";

/**
 * The watcher: what Cira checks on its own, every few minutes, so that the
 * people who manage an app hear about trouble before the people using it do.
 *
 * Everything else in Cira finds things out when someone looks. That is the
 * right bargain for a page, and the wrong one for an app that broke at 3 a.m.
 * or a report that failed on a Sunday. So this looks without being asked:
 * it settles deploys nobody stayed to watch, asks each running app whether it
 * answers, and reads each app's workers and scheduled runs - and tells the
 * app's managers about anything that went wrong (see notify.ts).
 *
 * Every check is its own; one app that cannot be asked does not stop the
 * rest, and nothing here throws.
 */

export interface WatchReport {
  deploysSettled: number;
  appsChecked: number;
  problems: number;
  /** Subscriptions whose seat or worker count was brought up to date. */
  billingSynced: number;
  /** Workers, runs and warm apps switched off because a plan no longer covers them. */
  switchedOff: number;
  /** Notices that failed before and went this time. */
  retried: number;
  /** What was set up in Stripe on this pass, when it was looked at. */
  stripe: StripeSetupReport | null;
}

/**
 * How long one pass may spend before it stops starting new checks. The cron
 * function is given 300 seconds; stopping short leaves room to finish the
 * checks already running, rather than being cut off in the middle of them.
 */
const BUDGET_MS = 240_000;

/** Apps checked at once: enough to finish quickly, few enough to be polite. */
const AT_ONCE = 4;
/** How long an app has to answer. A cold start is seconds, not tens. */
const ANSWER_TIMEOUT_MS = 25_000;

export async function watchEverything(now = new Date()): Promise<WatchReport> {
  const started = Date.now();
  const report: WatchReport = {
    deploysSettled: 0,
    appsChecked: 0,
    problems: 0,
    billingSynced: 0,
    switchedOff: 0,
    retried: 0,
    stripe: null,
  };

  // Deploys still in flight that nobody is polling: the CLI was closed, the
  // laptop went to sleep. Settling them is what notices a build that failed.
  const inFlight = await db()
    .select()
    .from(deployments)
    .where(notInArray(deployments.status, [...TERMINAL_STATUSES]));
  for (const deployment of inFlight) {
    const settled = await reconcileDeployment(deployment as Deployment).catch(() => null);
    if (settled !== null && settled.status !== deployment.status)
      report.deploysSettled += 1;
  }

  // Anything that failed to reach people last time goes first, while it is
  // still news.
  report.retried = await retryUnsent(now).catch(() => 0);

  // Stripe holding what Cira bills with and tells it about - checked every
  // few hours, and set up the first time a key is there, test or live.
  report.stripe = await ensureStripeSetup(now).catch((error: unknown) => {
    console.warn(
      `stripe setup not checked: ${error instanceof Error ? error.message : "error"}`,
    );
    return null;
  });

  // Every space before any app: its trial, what its plan still allows, and
  // what it is billed for. These are quick, and they used to run last, where
  // a pass slowed by apps that would not answer never reached them.
  const everySpace = await db()
    .select({
      id: spaces.id,
      plan: spaces.plan,
      createdAt: spaces.createdAt,
      status: spaces.subscriptionStatus,
      subscriptionId: spaces.stripeSubscriptionId,
    })
    .from(spaces);
  for (const space of everySpace) {
    const outcome = await watchSpace(space, now).catch(() => ({
      switchedOff: 0,
      synced: false,
    }));
    report.switchedOff += outcome.switchedOff;
    if (outcome.synced) report.billingSynced += 1;
  }

  const serving = await servingDeployments();
  for (let i = 0; i < serving.length; i += AT_ONCE) {
    if (Date.now() - started > BUDGET_MS) break;
    const batch = serving.slice(i, i + AT_ONCE);
    const problems = await Promise.all(
      batch.map((deployment) => watchApp(deployment, now).catch(() => 0)),
    );
    report.appsChecked += batch.length;
    report.problems += problems.reduce((a, b) => a + b, 0);
  }

  return report;
}

/** How long before a trial ends its admins are told it is ending. */
const TRIAL_WARNING_MS = 3 * 86_400_000;

/**
 * One space's own checks: tell its admins a trial is ending or has ended,
 * switch off what its plan no longer covers, and keep its bill in step with
 * what it has - people who joined or left, workers switched on.
 */
async function watchSpace(
  space: {
    id: string;
    plan: string;
    createdAt: Date;
    status: string | null;
    subscriptionId: string | null;
  },
  now: Date,
): Promise<{ switchedOff: number; synced: boolean }> {
  const plan = effectivePlan(space.plan, space.createdAt, now);
  const ends = trialEndsAt(space.createdAt);
  const neverPaid = space.status === null;

  if (plan.id === "trial" && ends.getTime() - now.getTime() <= TRIAL_WARNING_MS) {
    await notifyAdmins({
      spaceId: space.id,
      kind: "trial-ending",
      subject: ends.toISOString().slice(0, 10),
      compose: (s) => trialEndingMessage({ space: s, endsAt: ends }),
    });
  }
  if (plan.id === "lapsed" && neverPaid) {
    await notifyAdmins({
      spaceId: space.id,
      kind: "trial-ended",
      subject: ends.toISOString().slice(0, 10),
      compose: (s) => trialEndedMessage({ space: s }),
    });
  }

  const enforced = await enforcePlan(space.id);
  const changed = enforced.switchedOff.length + enforced.cooled.length;
  if (changed > 0) {
    await notifyAdmins({
      spaceId: space.id,
      kind: "plan-enforced",
      subject: `${now.toISOString().slice(0, 16)}:${[...enforced.switchedOff, ...enforced.cooled].join("|")}`,
      compose: (s) =>
        planEnforcedMessage({
          space: s,
          switchedOff: enforced.switchedOff,
          cooled: enforced.cooled,
        }),
    });
  }

  const synced =
    space.subscriptionId === null
      ? false
      : (await syncQuantities(space.id).catch(() => "skipped" as const)) === "changed";
  return { switchedOff: changed, synced };
}

/**
 * Whether asking this app if it answers is worth what the asking costs.
 *
 * An app of one container is billed only while it handles a request, so the
 * check costs a second of compute and is always worth it. An app with a
 * sidecar keeps its CPU on and is billed for as long as an instance exists;
 * Cloud Run keeps one for about fifteen minutes after its last request, so a
 * check every five minutes kept every such app running - and billed - around
 * the clock, for nobody. Those are checked only when someone would notice:
 * kept warm, opened in the last hour, or called in the last fifteen minutes.
 */
async function worthProbing(deployment: Deployment, now: Date): Promise<boolean> {
  const database = db();
  const [parts] = await database
    .select({ n: count() })
    .from(services)
    .where(eq(services.appId, deployment.appId));
  if ((parts?.n ?? 1) <= 1) return true;

  const [app] = await database
    .select({ minInstances: apps.minInstances })
    .from(apps)
    .where(eq(apps.id, deployment.appId))
    .limit(1);
  if ((app?.minInstances ?? 0) > 0) return true;

  const [opened] = await database
    .select({ id: appOpens.id })
    .from(appOpens)
    .where(
      and(
        eq(appOpens.appId, deployment.appId),
        gt(appOpens.openedAt, new Date(now.getTime() - 3600_000)),
      ),
    )
    .limit(1);
  if (opened !== undefined) return true;

  const [called] = await database
    .select({ id: invocations.id })
    .from(invocations)
    .where(
      and(
        eq(invocations.appId, deployment.appId),
        gt(invocations.createdAt, new Date(now.getTime() - 15 * 60_000)),
      ),
    )
    .limit(1);
  return called !== undefined;
}

/**
 * The deployment serving each app on Cloud Run: its newest live one, unless
 * the app has since been taken down.
 */
async function servingDeployments(): Promise<Deployment[]> {
  const rows = await db()
    .select()
    .from(deployments)
    .where(
      and(
        eq(deployments.provider, "cloudrun"),
        inArray(deployments.status, ["live", "removed"]),
      ),
    )
    .orderBy(desc(deployments.createdAt));

  const seen = new Set<string>();
  const serving: Deployment[] = [];
  for (const row of rows) {
    if (seen.has(row.appId)) continue;
    seen.add(row.appId);
    if (row.status === "live") serving.push(row as Deployment);
  }
  return serving;
}

/** One app's checks. Returns how many things were found wrong. */
async function watchApp(deployment: Deployment, now: Date): Promise<number> {
  let problems = 0;

  if (
    deployment.servesWeb &&
    deployment.url !== null &&
    (await worthProbing(deployment, now))
  ) {
    const answering = await answers(deployment.url);
    if (answering !== null) {
      if (!answering) problems += 1;
      await observe(deployment.appId, "web", answering, 2, null, now);
    }
  }

  const all = await listProcesses(deployment.appId);
  const on = all.filter((p) => p.enabled);
  // A worker switched off is not down; forget what was seen of it.
  const offWorkers = all.filter((p) => p.kind === "worker" && !p.enabled);
  if (offWorkers.length > 0) {
    await db()
      .delete(appWatch)
      .where(
        and(
          eq(appWatch.appId, deployment.appId),
          inArray(
            appWatch.target,
            offWorkers.map((p) => `worker:${p.name}`),
          ),
        ),
      );
  }
  if (on.length === 0) return problems;

  let states: ProcessState[];
  try {
    states = await deploymentProvider().processStates(
      deployment.providerDeploymentId,
      on.map((p) => ({ name: p.name, kind: p.kind })),
    );
  } catch {
    return problems;
  }

  for (const state of states) {
    const process = on.find((p) => p.name === state.name);
    if (process === undefined) continue;
    if (state.kind === "worker") {
      if (state.health === "missing" || state.instances === 0) continue;
      const outOfMemory =
        state.outOfMemoryAt !== null &&
        now.getTime() - new Date(state.outOfMemoryAt).getTime() <=
          WORKER_MEMORY_WINDOW_MS;
      const failing = state.health === "failed" || outOfMemory;
      if (failing) problems += 1;
      await observe(
        deployment.appId,
        `worker:${state.name}`,
        !failing,
        1,
        outOfMemory
          ? "it keeps running out of memory and being restarted"
          : "it failed to start",
        now,
      );
    } else {
      problems += await tellFailedRuns(deployment.appId, process, state.runs, now);
    }
  }
  return problems;
}

/**
 * Whether the app answers at all: any reply short of a server error counts,
 * a sign-in page and a 404 included. Null when Cira could not even ask, which
 * says nothing about the app.
 */
async function answers(url: string): Promise<boolean | null> {
  let token: string;
  try {
    token = await deploymentProvider().invocationToken(url);
  } catch {
    return null;
  }
  try {
    const response = await fetch(new URL("/", new URL(url).origin), {
      headers: { "x-serverless-authorization": `Bearer ${token}`, "x-cira-probe": "1" },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(ANSWER_TIMEOUT_MS),
    });
    return response.status < 500;
  } catch {
    return false;
  }
}

/** Record one check of one thing, and tell people if it crossed an edge. */
async function observe(
  appId: string,
  target: string,
  answering: boolean,
  threshold: number,
  why: string | null,
  now: Date,
): Promise<void> {
  const database = db();
  const [row] = await database
    .select()
    .from(appWatch)
    .where(and(eq(appWatch.appId, appId), eq(appWatch.target, target)))
    .limit(1);
  const previous: Watched | null =
    row === undefined ? null : { failures: row.failures, downSince: row.downSince };

  const { watched, event } = nextWatch(previous, answering, now, threshold);
  await database
    .insert(appWatch)
    .values({ appId, target, ...watched, checkedAt: now })
    .onConflictDoUpdate({
      target: [appWatch.appId, appWatch.target],
      set: { ...watched, checkedAt: now },
    });

  if (event === null) return;
  const worker = target.startsWith("worker:") ? target.slice("worker:".length) : null;
  const subject = `${target}@${event.since.toISOString()}`;
  if (event.kind === "down") {
    await notifyManagers({
      appId,
      kind: "app-down",
      subject,
      topic: target,
      compose: (app) =>
        notAnsweringMessage({
          app,
          worker,
          since: event.since,
          why: worker === null ? null : why,
          logs:
            worker === null
              ? app.logs
              : `${app.logs}?process=${encodeURIComponent(worker)}`,
        }),
    });
  } else {
    await notifyManagers({
      appId,
      kind: "app-back",
      subject,
      topic: target,
      compose: (app) => answeringAgainMessage({ app, worker, since: event.since, now }),
    });
  }
}

/** Tell people about each scheduled run that failed lately, once each. */
async function tellFailedRuns(
  appId: string,
  process: StoredProcess,
  runs: Extract<ProcessState, { kind: "scheduled" }>["runs"],
  now: Date,
): Promise<number> {
  let failed = 0;
  const parsed = process.schedule === null ? null : parseSchedule(process.schedule);
  const nextRunAt =
    parsed !== null && parsed.ok ? (nextRuns(parsed.schedule, now, 1)[0] ?? null) : null;

  for (const run of runs) {
    if (run.outcome !== "failed" || run.finishedAt === null) continue;
    const finished = new Date(run.finishedAt);
    if (now.getTime() - finished.getTime() > RUN_FAILURE_WINDOW_MS) continue;
    failed += 1;
    const startedAt = new Date(run.startedAt);
    await notifyManagers({
      appId,
      kind: "run-failed",
      subject: run.id,
      topic: `run:${process.name}`,
      compose: (app) =>
        runFailedMessage({
          app,
          run: process.name,
          startedAt,
          outOfMemory: run.outOfMemory,
          nextRunAt,
          logs: `${app.logs}?process=${encodeURIComponent(process.name)}&around=${encodeURIComponent(startedAt.toISOString())}`,
        }),
    });
  }
  return failed;
}
