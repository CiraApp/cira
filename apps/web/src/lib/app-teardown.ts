import "server-only";

import { eq } from "drizzle-orm";
import { apps, db, deployments } from "@cira/db";
import { deploymentProvider, parseHandle } from "@cira/deploy";
import type { App } from "@cira/core";

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

  // Every deployment of one app shares a service, so the name is taken once
  // rather than the service being deleted once per deploy. Rows from the
  // provider Cira used before Cloud Run are skipped: asking Google to remove
  // one of those fails, and an app nobody can delete is worse than an orphan.
  //
  // A failed deploy counts. The service is created before its build finishes,
  // so a build that failed still left one behind.
  let service: string | null = null;
  for (const row of rows) {
    if (row.provider !== "cloudrun" || row.status === "removed") continue;
    try {
      service = parseHandle(row.providerDeploymentId).service;
      break;
    } catch {
      // Not a handle this version wrote. Try the next.
    }
  }

  let images = true;
  if (service !== null) {
    try {
      ({ images } = await deploymentProvider().teardown(service));
    } catch {
      return {
        ok: false,
        error:
          "Cira could not take the running app down, so nothing was deleted. Try again shortly.",
      };
    }
  }

  // Deployments, capabilities, access and recorded variable names fall away
  // with the app; the schema says so.
  await database.delete(apps).where(eq(apps.id, app.id));

  return { ok: true, images };
}
