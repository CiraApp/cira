import "server-only";

import { eq } from "drizzle-orm";
import { apps, db } from "@cira/db";
import type { App, Deployment } from "@cira/core";
import { deploymentProvider } from "@cira/deploy";
import { probeWebUi } from "@/lib/browser-ui";

/**
 * Deciding when to go and ask, which is a separate job from the asking.
 *
 * Kept apart from the probe next door because this one needs the database, the
 * deployment record and a Google token, and the probe needs none of those - it
 * is one HTTP request and a reading of the reply. Two concerns in one module
 * would mean the part that talks to no one could not be tested without
 * standing up everything the other part talks to.
 */
/**
 * Settle whether an app serves a browser, if that is not yet known.
 *
 * Asked when someone looks at the app, not only when one is deployed. A deploy
 * is the obvious moment and it is not sufficient: every app that existed
 * before Cira learned to ask has never been asked, and would go on offering a
 * door to its own 404 until somebody happened to ship it again. The same is
 * true of an app whose earlier deploy could not be reached.
 *
 * It costs one request, once, and the answer is kept. An app that will not say
 * clearly gets asked again next time, which is the same bargain the deployment
 * reconciliation next door already makes: the moment a person is looking is
 * when the answer has to be true.
 */
export async function learnWebUi(app: App, deployment: Deployment | null): Promise<App> {
  if (app.hasWebUi !== null) return app;
  if (deployment === null || deployment.status !== "live" || deployment.url === null) {
    return app;
  }

  let token: string;
  try {
    token = await deploymentProvider().invocationToken(deployment.url);
  } catch {
    return app;
  }

  const answer = await probeWebUi({
    origin: new URL(deployment.url).origin,
    token,
  });

  if (answer === null) return app;

  await db()
    .update(apps)
    .set({ hasWebUi: answer, updatedAt: new Date() })
    .where(eq(apps.id, app.id));

  return { ...app, hasWebUi: answer };
}
