import "server-only";

import { eq } from "drizzle-orm";
import { db, memberships, teamMembers } from "@cira/db";
import type { Membership, Principal, User } from "@cira/core";

/**
 * Who a user is to the access rules, across every space they belong to.
 *
 * For the reads that start from a user rather than a session - the agent
 * surface, Ask Cira - which have to answer "what may this person see" without
 * a space in the URL to start from. Null when they belong to no space, which
 * means there is nothing for them to see at all.
 */
export async function principalFor(user: User): Promise<Principal | null> {
  const database = db();

  const mine = (await database
    .select()
    .from(memberships)
    .where(eq(memberships.userId, user.id))) as Membership[];

  if (mine.length === 0) return null;

  // Every team, not only one space's: teams are space-scoped, so an id from
  // another company can never match a grant.
  const onTeams = await database
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, user.id));

  return {
    userId: user.id,
    memberships: mine,
    teamIds: onTeams.map((t) => t.teamId),
  };
}
