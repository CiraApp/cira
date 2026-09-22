import "server-only";

import { eq, inArray } from "drizzle-orm";
import { appAccess, apps, db, processes, spaces, users } from "@cira/db";
import {
  describeMemory,
  visibleApps,
  type App,
  type AppAccess,
  type Deployment,
  type Principal,
  type ProcessRun,
  type RuntimeLogEntry,
  type User,
  crashCount,
  isProviderRecord,
} from "@cira/core";
import { deploymentProvider } from "@cira/deploy";
import { toApp } from "@/lib/capabilities";
import { reconcileDeployment } from "@/lib/deployment-sync";
import { principalManages } from "@/lib/app-rights";
import { principalFor } from "@/lib/principal";
import { processesForPage, type ProcessView } from "@/lib/processes";
import { latestDeployment } from "@/lib/queries";

/**
 * "Is the report still going out?", answered for Ask Cira and for agents.
 *
 * A company's software is more than the operations its apps expose: a worker
 * draining a queue and a report that runs every Monday are part of it too,
 * and the first thing anyone asks about them is whether they are working.
 * This is the app page's Processes section in words, under the page's rules:
 * whether each is running, how its runs went and when it runs next for anyone
 * who can open the app; the commands and the latest log lines only for those
 * who manage it, because logs are where an app writes things it never meant
 * to show.
 */

export type AppStatusOutcome =
  { ok: true; data: Record<string, unknown> } | { ok: false; error: string };

/** Log lines an answer carries: enough to see what a worker is doing, not a log reader. */
const LOG_LINES = 8;
const LOG_LINE_CHARS = 300;

export async function appStatusForUser(
  user: User,
  query: string,
  /** Cira's own origin, so the pages an answer points to are real links. */
  origin: string,
  /** Only this space's apps, for a surface opened inside one. */
  inSpace?: string,
): Promise<AppStatusOutcome> {
  const principal = await principalFor(user);
  const mine = (principal === null ? [] : await appsFor(principal)).filter(
    (visible) => inSpace === undefined || visible.spaceSlug === inSpace,
  );

  if (principal === null || mine.length === 0) {
    return { ok: false, error: "You cannot open any apps in Cira yet." };
  }

  if (query.trim() === "") return { ok: true, data: await shelf(mine) };

  const found = matchApps(mine, query);
  if (found.length === 1) {
    return { ok: true, data: await report(found[0]!, principal, origin) };
  }

  const listed = await shelf(found.length > 1 ? found : mine);
  return {
    ok: true,
    data: {
      ...listed,
      note:
        found.length > 1
          ? `More than one app matches "${query}". Ask which one is meant.`
          : `No app you can open is called "${query}". These are the ones you can; ` +
            "if one of them is clearly meant, check on it by its name.",
    },
  };
}

interface VisibleApp {
  app: App;
  spaceSlug: string;
  spaceName: string;
}

/** Every app this person can open, in every space they belong to. */
async function appsFor(principal: Principal): Promise<VisibleApp[]> {
  const database = db();
  const spaceIds = principal.memberships.map((m) => m.spaceId);

  const rows = await database
    .select({ app: apps, spaceSlug: spaces.slug, spaceName: spaces.name })
    .from(apps)
    .innerJoin(spaces, eq(spaces.id, apps.spaceId))
    .where(inArray(apps.spaceId, spaceIds));

  if (rows.length === 0) return [];

  const grants = (await database
    .select()
    .from(appAccess)
    .where(
      inArray(
        appAccess.appId,
        rows.map((r) => r.app.id),
      ),
    )) as AppAccess[];

  const open = new Set(
    visibleApps({ principal, apps: rows.map((r) => toApp(r.app)), access: grants }).map(
      (a) => a.id,
    ),
  );

  return rows
    .filter((r) => open.has(r.app.id))
    .map((r) => ({ app: toApp(r.app), spaceSlug: r.spaceSlug, spaceName: r.spaceName }))
    .sort((a, b) => a.app.name.localeCompare(b.app.name));
}

/**
 * Which app a person means, from the words they used.
 *
 * An exact name or slug wins outright. Failing that, a name inside what they
 * said ("the background app worker") or what they said inside a name, and
 * failing that, the apps sharing the most distinctive words with it. Words
 * every app could carry - "app", "worker", "job" - count for nothing, or
 * "the worker" would pick whichever app has "worker" in its name.
 */
export function matchApps<T extends { app: { name: string; slug: string } }>(
  candidates: readonly T[],
  query: string,
): T[] {
  const asked = plain(query);
  if (asked === "") return [];

  const names = (c: T) => [plain(c.app.name), plain(c.app.slug)];

  const exact = candidates.filter((c) => names(c).includes(asked));
  if (exact.length > 0) return exact;

  const contained = candidates.filter((c) =>
    names(c).some((n) => n !== "" && (asked.includes(n) || n.includes(asked))),
  );
  if (contained.length > 0) return contained;

  const wanted = words(asked);
  const scored = candidates
    .map((c) => {
      const theirs = new Set(names(c).flatMap(words));
      return { c, score: wanted.filter((w) => theirs.has(w)).length };
    })
    .filter((s) => s.score > 0);
  const best = Math.max(0, ...scored.map((s) => s.score));
  return scored.filter((s) => s.score === best).map((s) => s.c);
}

const GENERIC = new Set([
  "app",
  "apps",
  "the",
  "our",
  "service",
  "worker",
  "workers",
  "job",
  "jobs",
  "run",
  "runs",
  "scheduled",
  "background",
]);

function plain(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function words(text: string): string[] {
  return text.split(" ").filter((w) => w.length > 2 && !GENERIC.has(w));
}

/** The apps to choose from, with how much background work each has. */
async function shelf(list: readonly VisibleApp[]): Promise<Record<string, unknown>> {
  const counts =
    list.length === 0
      ? []
      : await db()
          .select({ appId: processes.appId, kind: processes.kind })
          .from(processes)
          .where(
            inArray(
              processes.appId,
              list.map((v) => v.app.id),
            ),
          );
  const spacesSeen = new Set(list.map((v) => v.spaceSlug));

  return {
    apps: list.map((v) => ({
      app: v.app.name,
      ...(spacesSeen.size > 1 ? { space: v.spaceName } : {}),
      workers: counts.filter((c) => c.appId === v.app.id && c.kind === "worker").length,
      scheduledRuns: counts.filter((c) => c.appId === v.app.id && c.kind === "scheduled")
        .length,
    })),
  };
}

async function report(
  visible: VisibleApp,
  principal: Principal,
  origin: string,
): Promise<Record<string, unknown>> {
  const { app, spaceSlug, spaceName } = visible;
  const manages = await principalManages(principal, app);

  const raw = await latestDeployment(app.id);
  // Asked the same way the app page asks, so the two cannot disagree.
  const deployment = raw === null ? null : await reconcileDeployment(raw);
  const handle =
    deployment?.provider === "cloudrun" ? deployment.providerDeploymentId : null;

  const [list, owner] = await Promise.all([
    processesForPage(app.id, handle, { commands: manages }),
    db()
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, app.ownerUserId))
      .limit(1),
  ]);

  const page = `${origin}/${spaceSlug}/${app.slug}`;
  const notes = [
    ...(list.length === 0
      ? ["This app has no workers or scheduled runs. It only answers requests."]
      : []),
    ...(manages
      ? []
      : [
          "Commands and log lines are shown only to the people who manage this app. " +
            "Everything else here is what its page shows.",
        ]),
  ];
  const described = await Promise.all(
    list.map((p) => describeProcess(p, manages ? handle : null)),
  );

  return {
    app: app.name,
    appId: app.id,
    space: spaceName,
    deployment: deploymentWords(deployment),
    ...(deployment === null
      ? {}
      : { lastDeployedAt: deployment.createdAt.toISOString() }),
    managedBy: owner[0]?.name ?? null,
    page,
    ...(manages ? { logs: `${origin}/${spaceSlug}/${app.slug}/logs` } : {}),
    processes: described,
    ...(notes.length === 0 ? {} : { notes }),
  };
}

function deploymentWords(deployment: Deployment | null): string {
  if (deployment === null) return "never deployed";
  switch (deployment.status) {
    case "live":
      return "live";
    case "queued":
    case "building":
    case "deploying":
      return "deploying now";
    case "failed":
      return "the last deploy failed";
    case "removed":
      return "removed";
    case "superseded":
      return "replaced by a newer deploy";
  }
}

/**
 * One process, as its row on the app page reads.
 *
 * `handle` is set only for a manager, and is what lets the latest log lines
 * be read: for a worker, what it wrote lately; for a scheduled run whose last
 * run failed, what that run wrote.
 */
async function describeProcess(
  p: ProcessView,
  handle: string | null,
): Promise<Record<string, unknown>> {
  const missing =
    (p.state?.kind === "worker" && p.state.health === "missing") ||
    (p.state?.kind === "scheduled" && !p.state.exists);
  const base = {
    name: p.name,
    kind: p.kind,
    ...(p.command === null ? {} : { command: p.command }),
    switchedOn: p.enabled,
    memory: describeMemory(p.memoryMiB),
    ...(p.outOfMemoryAt === null || missing
      ? {}
      : {
          ranOutOfMemory: {
            at: new Date(p.outOfMemoryAt).toISOString(),
            meaning:
              p.kind === "worker"
                ? "It was killed for using more memory than it has, and restarted. It needs more; the app's managers can give it more on the app's page."
                : "Its last run was killed for using more memory than it has. It needs more; the app's managers can give it more on the app's page.",
          },
        }),
  };

  if (p.kind === "worker") {
    const state = missing ? MISSING : !p.enabled ? "off" : workerWords(p);
    const lines =
      handle !== null && p.enabled && !missing
        ? await latestLines(handle, p, new Date(Date.now() - 24 * 3600_000), new Date())
        : undefined;
    return { ...base, state, ...(lines === undefined ? {} : { recentLogs: lines }) };
  }

  const runs = p.state?.kind === "scheduled" ? p.state.runs : null;
  const last = runs?.[0];
  const lines =
    handle !== null && last?.outcome === "failed"
      ? await latestLines(
          handle,
          p,
          new Date(new Date(last.startedAt).getTime() - 30_000),
          new Date(new Date(last.finishedAt ?? Date.now()).getTime() + 60_000),
        )
      : undefined;

  return {
    ...base,
    state: missing
      ? MISSING
      : p.schedule === null
        ? "no timetable yet, so it never runs on its own"
        : p.enabled
          ? "on"
          : "off, so it does not run on its timetable",
    timetable: p.scheduleWords,
    ...(p.enabled && p.nextRunAt !== null
      ? { nextRunAt: p.nextRunAt.toISOString() }
      : {}),
    maxMinutesPerRun: p.timeoutMinutes,
    ...(runs === null
      ? { runs: "Cira could not reach Google Cloud to check its runs just now." }
      : {
          recentRuns: runs.map(runWords),
          ...(runs.length === 0 ? { note: "It has not run yet." } : {}),
        }),
    ...(lines === undefined ? {} : { lastRunLogs: lines }),
  };
}

const MISSING = "not created yet: the app has to be deployed again";

function workerWords(p: ProcessView): string {
  const health = p.state?.kind === "worker" ? p.state.health : null;
  if (health === null) return "on, but Cira could not reach Google Cloud to check it";
  if (health === "failed") return "failed to start";
  if (health === "starting") return "starting";
  if (p.crashes !== null) {
    return `keeps stopping: it exited ${crashCount(p.crashes)} and was restarted each time`;
  }
  if (p.outOfMemoryAt !== null) return "running, but it ran out of memory recently";
  return "running";
}

function runWords(run: ProcessRun): Record<string, unknown> {
  const started = new Date(run.startedAt);
  const finished = run.finishedAt === null ? null : new Date(run.finishedAt);
  return {
    startedAt: started.toISOString(),
    outcome: run.outcome,
    ...(run.outOfMemory ? { cause: "ran out of memory" } : {}),
    ...(finished === null
      ? {}
      : { took: took(Math.round((finished.getTime() - started.getTime()) / 1000)) }),
  };
}

function took(seconds: number): string {
  const s = Math.max(0, seconds);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** The last few lines a process wrote in a window, oldest first, or a sentence. */
async function latestLines(
  handle: string,
  p: ProcessView,
  since: Date,
  until: Date,
): Promise<string[] | string> {
  try {
    const page = await deploymentProvider().getRuntimeLogs(handle, {
      process: { kind: p.kind, name: p.name },
      since,
      until,
      minimum: "all",
      search: null,
      order: "newest",
      pageToken: null,
      limit: LOG_LINES,
    });
    const said = page.entries.filter((entry) => !isProviderRecord(entry.message));
    if (said.length === 0) return "Nothing logged in that time.";
    return said.slice(0, LOG_LINES).reverse().map(line);
  } catch {
    return "Cira could not read the logs just now.";
  }
}

function line(entry: RuntimeLogEntry): string {
  const text =
    entry.message.length > LOG_LINE_CHARS
      ? `${entry.message.slice(0, LOG_LINE_CHARS)}...`
      : entry.message;
  const level = entry.level === "default" ? "" : ` ${entry.level}`;
  return `${new Date(entry.timestamp).toISOString()}${level} ${text}`;
}
