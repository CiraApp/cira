import "server-only";

import { eq } from "drizzle-orm";
import { apps, db, deployments, removedApps } from "@cira/db";
import { deploymentProvider, parseHandle } from "@cira/deploy";
import type { App } from "@cira/core";
import { resourcesOf } from "@/lib/usage";

/**
 * Take an app down and remove what it left behind.
 *
 * One place, because there are two doors to it - the app's own settings page
 * and `cira remove` - and a teardown that differs by which door you came
 * through is a teardown that leaves different garbage depending on the day.
 *
 * The order matters. Google is told first: an app Cira has forgotten but which
 * is still serving is worse than one that is merely still listed, because
 * nobody would know to go and stop it.
 */

export type TeardownResult = { ok: true; images: boolean } | { ok: false; error: string };

export async function tearDownApp(app: App): Promise<TeardownResult> {
  const database = db();

  const rows = await database
    .select()
    .from(deployments)
    .where(eq(deployments.appId, app.id));

  let images = true;
  for (const service of servicesOf(rows)) {
    try {
      const outcome = await deploymentProvider().teardown(service);
      images &&= outcome.images;
    } catch {
      return {
        ok: false,
        error:
          "Cira could not take the running app down, so nothing was deleted. Try again shortly.",
      };
    }
  }

  // Kept so this month's usage still counts what the app ran before it went.
  const resources = await resourcesOf(app.id).catch(() => []);
  if (resources.length > 0) {
    await database
      .insert(removedApps)
      .values({ id: app.id, spaceId: app.spaceId, name: app.name, resources })
      .onConflictDoNothing();
  }

  // Deployments, capabilities, access and recorded variable names fall away
  // with the app; the schema says so.
  await database.delete(apps).where(eq(apps.id, app.id));

  return { ok: true, images };
}

/**
 * Every name this app has run under at Google.
 *
 * Usually one. An app renamed before its name was kept stable got a second
 * service on its next deploy, and the first went on running, so every name
 * any deployment ever recorded is taken down - each is idempotent, and one
 * left behind is software nobody can see still serving.
 *
 * A failed deploy counts: the service is created before its build finishes.
 * Rows from the provider Cira used before Cloud Run are skipped, because
 * asking Google to remove one of those fails, and an app nobody can delete is
 * worse than an orphan.
 */
export function servicesOf(
  rows: ReadonlyArray<{ provider: string; providerDeploymentId: string }>,
): string[] {
  const names = new Set<string>();
  for (const row of rows) {
    if (row.provider !== "cloudrun") continue;
    try {
      names.add(parseHandle(row.providerDeploymentId).service);
    } catch {
      // Not a handle this version wrote.
    }
  }
  return [...names].sort();
}
