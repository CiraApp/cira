import "server-only";

import { and, count, eq, gte, inArray, lt } from "drizzle-orm";
import {
  apps,
  askUsage,
  db,
  deployments,
  invocations,
  memberships,
  processes,
  removedApps,
  services,
} from "@cira/db";
import { computeCost, DEFAULT_LIMITS, requestCost, type App } from "@cira/core";
import { deploymentProvider, parseHandle, processResourceName } from "@cira/deploy";

/**
 * What a company used, and what it cost Cira to run.
 *
 * Every company's apps run in one Google project on one bill, so nothing in
 * Google says whose is whose. Cira knows: a deployment names the service it
 * made, and a process names the job or worker pool. So Google is asked what
 * each thing ran for, Cira says which app each thing belongs to, and
 * pricing.ts turns instance-seconds into money.
 *
 * It is an estimate of cost, not an invoice - rounded up rather than down,
 * and without Google's free tier - and it is the number a plan has to cover.
 */

export interface AppUsage {
  appId: string;
  name: string;
  /** Null for an app removed since, which has no page to link to. */
  slug: string | null;
  /** Instance time across its service, workers and scheduled runs. */
  instanceSeconds: number;
  requests: number;
  dollars: number;
}

export interface SpaceUsage {
  since: Date;
  until: Date;
  apps: AppUsage[];
  dollars: number;
  instanceSeconds: number;
  requests: number;
  /** What people did with Cira itself in the window. */
  deploys: number;
  capabilityRuns: number;
  questions: number;
}

export type UsageOutcome =
  | { ok: true; usage: SpaceUsage }
  | { ok: false; reason: "not-allowed" | "disabled" | "unavailable" };

/** The month so far, which is the window a bill is measured in. */
export function monthSoFar(now = new Date()): { since: Date; until: Date } {
  return {
    since: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    until: now,
  };
}

export async function spaceUsage(
  spaceId: string,
  window: { since: Date; until: Date } = monthSoFar(),
): Promise<UsageOutcome> {
  const database = db();
  const rows = (await database
    .select()
    .from(apps)
    .where(eq(apps.spaceId, spaceId))) as App[];

  let totals;
  try {
    totals = await deploymentProvider().readUsage(window.since, window.until);
  } catch (error) {
    const reason =
      error !== null && typeof error === "object" && "reason" in error
        ? (error as { reason: "not-allowed" | "disabled" | "unavailable" }).reason
        : "unavailable";
    return { ok: false, reason };
  }

  const used: AppUsage[] = [];
  for (const app of rows) {
    const names = await resourcesOf(app.id);
    const perApp = { instanceSeconds: 0, requests: 0, dollars: 0 };

    for (const resource of names) {
      const seconds = totals.instanceSeconds.get(resource.name) ?? 0;
      const requests = totals.requests.get(resource.name) ?? 0;
      perApp.instanceSeconds += seconds;
      perApp.requests += requests;
      perApp.dollars +=
        computeCost({
          instanceSeconds: seconds,
          cpu: DEFAULT_LIMITS.app.cpu,
          memoryMiB: resource.memoryMiB,
        }) + requestCost(requests);
    }

    used.push({ appId: app.id, name: app.name, slug: app.slug, ...perApp });
  }

  // Apps removed this month still ran this month, and Google still billed it.
  const removed = await database
    .select()
    .from(removedApps)
    .where(
      and(eq(removedApps.spaceId, spaceId), gte(removedApps.removedAt, window.since)),
    );
  for (const app of removed) {
    const perApp = { instanceSeconds: 0, requests: 0, dollars: 0 };
    for (const resource of app.resources) {
      const seconds = totals.instanceSeconds.get(resource.name) ?? 0;
      const requests = totals.requests.get(resource.name) ?? 0;
      perApp.instanceSeconds += seconds;
      perApp.requests += requests;
      perApp.dollars +=
        computeCost({
          instanceSeconds: seconds,
          cpu: DEFAULT_LIMITS.app.cpu,
          memoryMiB: resource.memoryMiB,
        }) + requestCost(requests);
    }
    if (perApp.instanceSeconds === 0 && perApp.requests === 0) continue;
    used.push({ appId: app.id, name: app.name, slug: null, ...perApp });
  }

  used.sort((a, b) => b.dollars - a.dollars || a.name.localeCompare(b.name));

  const [deploys, capabilityRuns, questions] = await Promise.all([
    countIn(deployments, spaceId, window),
    countIn(invocations, spaceId, window),
    questionsIn(spaceId, window),
  ]);

  return {
    ok: true,
    usage: {
      ...window,
      apps: used,
      dollars: used.reduce((total, a) => total + a.dollars, 0),
      instanceSeconds: used.reduce((total, a) => total + a.instanceSeconds, 0),
      requests: used.reduce((total, a) => total + a.requests, 0),
      deploys,
      capabilityRuns,
      questions,
    },
  };
}

/**
 * Everything on Google that belongs to one app, by the name Google knows it
 * by, with the memory each was given. Services an app was deployed under
 * before a rename are included: they ran, so they cost something.
 */
export async function resourcesOf(
  appId: string,
): Promise<Array<{ name: string; memoryMiB: number }>> {
  const database = db();
  const [deployed, own, parts] = await Promise.all([
    database
      .select({
        handle: deployments.providerDeploymentId,
        provider: deployments.provider,
      })
      .from(deployments)
      .where(eq(deployments.appId, appId)),
    database
      .select({ name: processes.name, memoryMiB: processes.memoryMiB })
      .from(processes)
      .where(eq(processes.appId, appId)),
    database.select({ id: services.id }).from(services).where(eq(services.appId, appId)),
  ]);

  const serviceMemory =
    parts.length > 1
      ? DEFAULT_LIMITS.app.memoryMiBWithSidecars
      : DEFAULT_LIMITS.app.memoryMiB;

  const found = new Map<string, number>();
  for (const row of deployed) {
    if (row.provider !== "cloudrun") continue;
    const service = parseHandle(row.handle).service;
    found.set(service, serviceMemory);
    for (const process of own) {
      found.set(
        processResourceName(service, process.name),
        process.memoryMiB ?? DEFAULT_LIMITS.processes.defaultMemoryMiB,
      );
    }
  }
  return [...found].map(([name, memoryMiB]) => ({ name, memoryMiB }));
}

type Counted = typeof deployments | typeof invocations;

async function countIn(
  table: Counted,
  spaceId: string,
  window: { since: Date; until: Date },
): Promise<number> {
  const [row] = await db()
    .select({ n: count() })
    .from(table)
    .innerJoin(apps, eq(apps.id, table.appId))
    .where(
      and(
        eq(apps.spaceId, spaceId),
        gte(table.createdAt, window.since),
        lt(table.createdAt, window.until),
      ),
    );
  return row?.n ?? 0;
}

/** Questions put to Ask Cira by the space's own people. */
async function questionsIn(
  spaceId: string,
  window: { since: Date; until: Date },
): Promise<number> {
  const database = db();
  const people = await database
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(eq(memberships.spaceId, spaceId));
  if (people.length === 0) return 0;

  const [row] = await database
    .select({ n: count() })
    .from(askUsage)
    .where(
      and(
        inArray(
          askUsage.userId,
          people.map((p) => p.userId),
        ),
        eq(askUsage.kind, "question"),
        gte(askUsage.createdAt, window.since),
        lt(askUsage.createdAt, window.until),
      ),
    );
  return row?.n ?? 0;
}
