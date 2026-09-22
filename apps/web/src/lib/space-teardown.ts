import "server-only";

import { eq } from "drizzle-orm";
import { apps, db, spaces } from "@cira/db";
import type { App, Space } from "@cira/core";
import { removeSso } from "@/lib/sso";
import { tearDownApp } from "@/lib/app-teardown";

/**
 * Taking a whole company off Cira.
 *
 * The order is the same as one app's teardown, for the same reason: Google is
 * told first, because software Cira has forgotten but which is still running
 * is worse than a record nobody reads - nobody would know to go and stop it.
 * Only when every app is down does the space itself go, and everything hanging
 * off it with it.
 *
 * It stops at the first app it cannot take down, and says which. Half a
 * teardown that reported success would leave a company paying Google for
 * something Cira no longer lists.
 */

export type SpaceTeardown = { ok: true; apps: number } | { ok: false; error: string };

export async function tearDownSpace(space: Space): Promise<SpaceTeardown> {
  const database = db();
  const own = (await database
    .select()
    .from(apps)
    .where(eq(apps.spaceId, space.id))) as App[];

  for (const app of own) {
    const result = await tearDownApp(app);
    if (!result.ok) {
      return {
        ok: false,
        error: `${app.name} could not be taken down, so nothing was deleted. ${result.error}`,
      };
    }
  }

  // The company's sign-in connection lives in Clerk, not here: left behind,
  // it would go on sending everyone at the domain to a provider for a space
  // that no longer exists.
  const sso = await removeSso(space.id);
  if (!sso.ok) {
    return {
      ok: false,
      error: `Its apps are gone, but its company sign-in was not: ${sso.error}`,
    };
  }

  // Members, teams, invitations, notifications and everything else that hangs
  // off the space go with it; the schema says so.
  await database.delete(spaces).where(eq(spaces.id, space.id));

  return { ok: true, apps: own.length };
}
