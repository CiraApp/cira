import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { apps, capabilities, db } from "@cira/db";
import { currentReach, type User } from "@cira/core";
import { deploymentProvider } from "@cira/deploy";
import { probeWebUi } from "@/lib/browser-ui";
import { recordVerification } from "@/lib/capabilities";
import { verifyCapabilities } from "@/lib/capability-verify";
import { assertIdentity } from "@/lib/identity-assertion";
import { latestDeployment } from "@/lib/queries";
import { demoAnswers } from "@/lib/demo/answers";

/**
 * Ask the app whether the capabilities credited to it are real.
 *
 * Reading source can be wrong; the running app cannot. Lifted out of the route
 * the CLI calls because it is not a step of deploying - it is a step of
 * finding capabilities, and finding them from the app's own page skipped it
 * entirely. Everything that turned up that way stayed unverified, which the
 * panel honestly reported as "Checking" and would have gone on reporting for
 * ever.
 */

export type VerificationOutcome =
  | {
      ok: true;
      callable: number;
      /** Served, and shut to Cira. Kept and explained rather than deleted. */
      refused: number;
      absent: number;
      inconclusive: boolean;
    }
  | { ok: false; reason: "not-running" | "unreachable" };

const SETTLED = {
  ok: true,
  callable: 0,
  refused: 0,
  absent: 0,
  inconclusive: false,
} as const;

export async function verifyAppCapabilities(
  appId: string,
  /** Who this is being checked for, when an app is told who is calling. */
  actor?: { user: User; spaceSlug: string },
  /**
   * Right after a deploy, also ask again about what worked under the build
   * before. A callable answer is otherwise never asked again, so a route that
   * started refusing Cira in a new build - behind a sign-in added in it - was
   * only found out when an agent called it, and nobody was told it had
   * stopped. Kept as it is while being asked, so nothing working goes dark.
   */
  options: { afterDeploy?: boolean } = {},
): Promise<VerificationOutcome> {
  const database = db();

  const newest = await latestDeployment(appId);
  // The deployment answering requests, if there is one. Held as the row rather
  // than as a flag so that everything below that needs its id or address has
  // it without being told twice.
  const serving =
    newest !== null && newest.status === "live" && newest.url !== null
      ? { id: newest.id, url: newest.url }
      : null;

  // Everything waiting on an answer: what has never been asked about, and any
  // refusal that came from a build no longer serving. The second is how a
  // developer who let Cira in gets heard - their routes kept their paths, so
  // nothing else would have put them back in front of the app.
  const pending = (
    await database
      .select({
        name: capabilities.name,
        method: capabilities.method,
        path: capabilities.path,
        risk: capabilities.risk,
        probe: capabilities.probe,
        reach: capabilities.reach,
        answeredBy: capabilities.answeredBy,
      })
      .from(capabilities)
      .where(
        and(
          eq(capabilities.appId, appId),
          inArray(capabilities.reach, ["pending", "refused"]),
        ),
      )
  ).filter((row) => currentReach(row, serving?.id ?? null) === "pending");
  const confirmedBefore = (
    serving === null || options.afterDeploy !== true
      ? []
      : await database
          .select({
            name: capabilities.name,
            method: capabilities.method,
            path: capabilities.path,
            risk: capabilities.risk,
            probe: capabilities.probe,
            reach: capabilities.reach,
            answeredBy: capabilities.answeredBy,
          })
          .from(capabilities)
          .where(and(eq(capabilities.appId, appId), eq(capabilities.reach, "callable")))
  ).filter((row) => row.answeredBy !== serving?.id);

  // The demo company's apps answer from a table rather than over a network,
  // so asking them is a lookup: whatever the table can answer is callable, and
  // nothing is minted, probed or sent anywhere.
  if (serving !== null && newest?.provider === "demo" && pending.length > 0) {
    const app = await database
      .select({ slug: apps.slug })
      .from(apps)
      .where(eq(apps.id, appId))
      .limit(1);
    const slug = app[0]?.slug ?? "";
    const callable = pending
      .filter((row) => demoAnswers(slug, row.name))
      .map((row) => row.name);
    await recordVerification({
      appId,
      deploymentId: serving.id,
      callable,
      refused: [],
      absent: [],
    });
    return { ...SETTLED, callable: callable.length };
  }

  if (serving === null) {
    if (pending.length === 0) {
      return SETTLED;
    }
    return { ok: false, reason: "not-running" };
  }

  let token: string;
  try {
    token = await deploymentProvider().invocationToken(serving.url);
  } catch {
    if (pending.length === 0) {
      return SETTLED;
    }
    return { ok: false, reason: "unreachable" };
  }

  const origin = new URL(serving.url).origin;

  // Asked on every run rather than only when capabilities changed, because
  // whether an app has a front door is a fact about the deploy and not about
  // its capabilities. Null means the app did not answer clearly enough to
  // conclude anything, and then whatever was known is left alone.
  const webUi = await probeWebUi({ origin, token });
  if (webUi !== null) {
    await database
      .update(apps)
      .set({ hasWebUi: webUi, updatedAt: new Date() })
      .where(eq(apps.id, appId));
  }

  if (pending.length === 0 && confirmedBefore.length === 0) return SETTLED;

  // Only for an app whose managers asked to be told, and only when a person
  // is behind the check; a background run speaks for nobody, as before.
  const [told] = await database
    .select({ tellsWhoIsCalling: apps.tellsWhoIsCalling })
    .from(apps)
    .where(eq(apps.id, appId))
    .limit(1);

  const identity =
    told?.tellsWhoIsCalling === true && actor !== undefined
      ? (assertIdentity({
          user: actor.user,
          spaceSlug: actor.spaceSlug,
          audience: new URL(origin).origin,
          via: "console",
        }) ?? undefined)
      : undefined;

  // What worked is asked again only as whoever it worked for. An app that
  // lets people in by Cira's statement refuses a check that carries none, and
  // that would read as every working route having stopped.
  const asking =
    told?.tellsWhoIsCalling === true && identity === undefined
      ? pending
      : [...pending, ...confirmedBefore];
  if (asking.length === 0) return SETTLED;

  const outcome = await verifyCapabilities({
    origin,
    token,
    identity,
    capabilities: asking.map((row) => ({
      name: row.name,
      method: row.method,
      path: row.path,
      risk: row.risk === "read" ? "read" : "write",
      probe: (row.probe as Record<string, unknown> | null) ?? undefined,
    })),
  });

  // Nothing is recorded when the app answers everything. Stamping capabilities
  // an app confirmed indiscriminately would be worse than leaving them off.
  if (!outcome.inconclusive) {
    await recordVerification({
      appId,
      deploymentId: serving.id,
      callable: outcome.callable,
      refused: outcome.refused,
      absent: outcome.absent,
    });
  }

  return {
    ok: true,
    callable: outcome.callable.length,
    refused: outcome.refused.length,
    absent: outcome.absent.length,
    inconclusive: outcome.inconclusive,
  };
}
