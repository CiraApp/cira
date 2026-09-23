import "server-only";

import { possessive } from "@cira/core";
import { and, eq, gt, inArray } from "drizzle-orm";
import { apps, db, processes } from "@cira/db";
import { deploymentProvider } from "@cira/deploy";
import { planForSpace } from "@/lib/plan";
import { listProcesses, specsFor } from "@/lib/processes";
import { latestDeployment } from "@/lib/queries";

/**
 * Making what runs match what a space's plan allows.
 *
 * A plan's limits used to be checked only when someone switched something on.
 * Nothing ever switched anything off, so a trial ran its worker for ever, and
 * a company that cancelled kept every worker and warm app running for free -
 * about fifty dollars a month each, paid by Cira. This is what does it: run by
 * the watcher for every space, and straight away when a subscription ends.
 *
 * What goes, and in what order: workers and scheduled runs over the plan's
 * allowance, the most recently switched on first, so what a company has
 * relied on longest is what stays; and every warm app, when the plan does not
 * include keeping one warm. Web apps are never touched - they cost pennies
 * idle, and a company's software is not held hostage over a bill. Google is
 * told before the record changes, so the record never says off about
 * something that is still running.
 */

export interface Enforced {
  /** "Payroll's worker", in words for an email. */
  switchedOff: string[];
  cooled: string[];
}

export async function enforcePlan(spaceId: string): Promise<Enforced> {
  const plan = await planForSpace(spaceId);
  const database = db();
  const out: Enforced = { switchedOff: [], cooled: [] };

  const spaceApps = await database
    .select({ id: apps.id, name: apps.name, minInstances: apps.minInstances })
    .from(apps)
    .where(eq(apps.spaceId, spaceId));
  if (spaceApps.length === 0) return out;
  const nameOf = new Map(spaceApps.map((a) => [a.id, a.name]));

  const running = await database
    .select({
      id: processes.id,
      appId: processes.appId,
      name: processes.name,
      kind: processes.kind,
      updatedAt: processes.updatedAt,
    })
    .from(processes)
    .where(
      and(
        inArray(
          processes.appId,
          spaceApps.map((a) => a.id),
        ),
        eq(processes.enabled, true),
      ),
    );

  const allowance = {
    worker: plan.limits.processes.workersPerSpace,
    scheduled: plan.limits.processes.scheduledPerSpace,
  } as const;

  for (const kind of ["worker", "scheduled"] as const) {
    // Oldest first: what has run longest is what the company relies on.
    const on = running
      .filter((p) => p.kind === kind)
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
    for (const extra of on.slice(allowance[kind])) {
      if (await switchOff(extra.appId, extra.name)) {
        const app = nameOf.get(extra.appId) ?? "An app";
        out.switchedOff.push(
          kind === "worker"
            ? `${possessive(app)} worker ${extra.name}`
            : `${possessive(app)} scheduled run ${extra.name}`,
        );
      }
    }
  }

  if (!plan.canKeepWarm) {
    for (const app of spaceApps.filter((a) => a.minInstances > 0)) {
      if (await cool(app.id)) out.cooled.push(app.name);
    }
  }

  return out;
}

async function switchOff(appId: string, name: string): Promise<boolean> {
  const process = (await listProcesses(appId)).find((p) => p.name === name);
  const deployment = await latestDeployment(appId);
  if (process === undefined) return false;

  if (deployment !== null && deployment.provider === "cloudrun") {
    const [spec] = specsFor([{ ...process, enabled: false }]);
    try {
      await deploymentProvider().setProcess(deployment.providerDeploymentId, spec!);
    } catch {
      // Tried again on the watcher's next pass. Better still running and
      // recorded as running than stopped in the record and not at Google.
      return false;
    }
  }

  await db()
    .update(processes)
    .set({ enabled: false, updatedAt: new Date() })
    .where(eq(processes.id, process.id));
  return true;
}

async function cool(appId: string): Promise<boolean> {
  const deployment = await latestDeployment(appId);
  if (deployment !== null && deployment.provider === "cloudrun" && deployment.servesWeb) {
    try {
      await deploymentProvider().setMinInstances(deployment.providerDeploymentId, 0);
    } catch {
      return false;
    }
  }
  await db()
    .update(apps)
    .set({ minInstances: 0, updatedAt: new Date() })
    .where(and(eq(apps.id, appId), gt(apps.minInstances, 0)));
  return true;
}
