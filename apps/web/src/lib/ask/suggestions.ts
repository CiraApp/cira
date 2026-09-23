import "server-only";

import { canRun, type User } from "@cira/core";
import type { Suggestion } from "@/components/ask/ask-provider";
import { listCapabilitiesForUser } from "@/lib/capabilities";

/**
 * Questions worth offering someone who has never used Ask Cira.
 *
 * Taken from what they can really run in this space - switched on, confirmed
 * by the app, and only reads - so the first thing anyone taps works and never
 * stops to ask permission. One per app before a second from any, so the list
 * shows how much there is to ask about rather than four ways into one app.
 *
 * Also says whether anything here is still waiting to be confirmed, which
 * opening the space settles; see `verifyPendingInSpace`.
 */
export async function askSuggestions(
  user: User,
  spaceSlug: string,
  limit = 4,
): Promise<{ suggestions: Suggestion[]; unsettled: boolean }> {
  const here = (await listCapabilitiesForUser(user)).filter(
    (c) => c.spaceSlug === spaceSlug,
  );
  const usable = here.filter(
    // Confirmed, or turned on by a person although the app could not confirm it.
    (c) => c.enabled && canRun(c.reach) && c.risk === "read",
  );

  const picked: typeof usable = [];
  const apps = new Set<string>();
  for (const capability of usable) {
    if (picked.length === limit) break;
    if (apps.has(capability.appId)) continue;
    apps.add(capability.appId);
    picked.push(capability);
  }
  for (const capability of usable) {
    if (picked.length === limit) break;
    if (!picked.includes(capability)) picked.push(capability);
  }

  return {
    suggestions: picked.map((capability) => ({
      question: capability.description.trim().replace(/\.$/, ""),
      app: { id: capability.appId, name: capability.appName },
    })),
    unsettled: here.some((c) => c.reach === "pending"),
  };
}
