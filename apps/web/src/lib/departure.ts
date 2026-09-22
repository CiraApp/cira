import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import {
  appAccess,
  apps,
  atomically,
  db,
  memberships,
  spaceJoinBlocks,
  teamMembers,
  teams,
} from "@cira/db";
import { newId } from "@cira/core";

/**
 * A person leaving a space, however it happens: removed by an admin, leaving
 * of their own accord, or deactivated by the company's identity provider.
 * One act, so all three leave the same nothing behind.
 */

/** Everything a person leaves behind, handled in one act. */
export async function depart(args: {
  spaceId: string;
  membershipId: string;
  userId: string;
  email: string;
  heir: string;
  blockRejoin: boolean;
}): Promise<void> {
  const database = db();
  const spaceApps = await database
    .select({ id: apps.id })
    .from(apps)
    .where(eq(apps.spaceId, args.spaceId));
  const spaceTeams = await database
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.spaceId, args.spaceId));
  const appIds = spaceApps.map((a) => a.id);
  const teamIds = spaceTeams.map((t) => t.id);

  await atomically(database, (on) => [
    // Nothing a company runs may end up owned by someone who is not in it:
    // an owner outside the space can manage nothing, so the app would have
    // nobody but admins, and its alerts would go nowhere in particular.
    on
      .update(apps)
      .set({ ownerUserId: args.heir, updatedAt: new Date() })
      .where(and(eq(apps.spaceId, args.spaceId), eq(apps.ownerUserId, args.userId))),
    ...(appIds.length > 0
      ? [
          on
            .delete(appAccess)
            .where(
              and(
                eq(appAccess.type, "user"),
                eq(appAccess.targetId, args.userId),
                inArray(appAccess.appId, appIds),
              ),
            ),
        ]
      : []),
    ...(teamIds.length > 0
      ? [
          on
            .delete(teamMembers)
            .where(
              and(
                eq(teamMembers.userId, args.userId),
                inArray(teamMembers.teamId, teamIds),
              ),
            ),
        ]
      : []),
    ...(args.blockRejoin
      ? [
          on
            .insert(spaceJoinBlocks)
            .values({
              id: newId("joinBlock"),
              spaceId: args.spaceId,
              email: args.email.toLowerCase(),
            })
            .onConflictDoNothing(),
        ]
      : []),
    on.delete(memberships).where(eq(memberships.id, args.membershipId)),
  ]);
}
