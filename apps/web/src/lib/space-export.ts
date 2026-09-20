import "server-only";

import { eq, inArray } from "drizzle-orm";
import {
  appAccess,
  apps,
  capabilities,
  db,
  deployments,
  appEnvVars,
  invites,
  memberships,
  processes,
  services,
  spaces,
  teamMembers,
  teams,
  users,
} from "@cira/db";

/**
 * Everything Cira holds about one company, as one file.
 *
 * A company should be able to leave with what is theirs, and should be able
 * to see what Cira knows before deciding to. That is most of the point: this
 * is a short file, because Cira holds metadata about software rather than the
 * software's data. No environment values (Cira never stored them, see
 * docs/secrets.md), no capability inputs or replies, no logs - those live
 * with the app and with Google.
 *
 * Written as plain JSON rather than a report, because the reader might be a
 * person deciding whether to trust Cira or a script moving off it.
 */

export interface SpaceExport {
  exportedAt: string;
  note: string;
  space: Record<string, unknown>;
  people: Array<Record<string, unknown>>;
  teams: Array<Record<string, unknown>>;
  invitations: Array<Record<string, unknown>>;
  apps: Array<Record<string, unknown>>;
}

export async function exportSpace(spaceId: string): Promise<SpaceExport | null> {
  const database = db();
  const [space] = await database.select().from(spaces).where(eq(spaces.id, spaceId));
  if (space === undefined) return null;

  const [people, spaceTeams, pending, ownApps] = await Promise.all([
    database
      .select({ user: users, role: memberships.role, joined: memberships.createdAt })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.spaceId, spaceId)),
    database.select().from(teams).where(eq(teams.spaceId, spaceId)),
    database.select().from(invites).where(eq(invites.spaceId, spaceId)),
    database.select().from(apps).where(eq(apps.spaceId, spaceId)),
  ]);

  const appIds = ownApps.map((app) => app.id);
  const none = appIds.length === 0;

  const [grants, parts, ops, background, deploys, variables, teamPeople] =
    await Promise.all([
      none
        ? []
        : database.select().from(appAccess).where(inArray(appAccess.appId, appIds)),
      none ? [] : database.select().from(services).where(inArray(services.appId, appIds)),
      none
        ? []
        : database.select().from(capabilities).where(inArray(capabilities.appId, appIds)),
      none
        ? []
        : database.select().from(processes).where(inArray(processes.appId, appIds)),
      none
        ? []
        : database.select().from(deployments).where(inArray(deployments.appId, appIds)),
      // Variable names, never values: Cira is a conduit, not a vault.
      none
        ? []
        : database.select().from(appEnvVars).where(inArray(appEnvVars.appId, appIds)),
      spaceTeams.length === 0
        ? []
        : database
            .select({ teamId: teamMembers.teamId, email: users.email })
            .from(teamMembers)
            .innerJoin(users, eq(users.id, teamMembers.userId))
            .where(
              inArray(
                teamMembers.teamId,
                spaceTeams.map((team) => team.id),
              ),
            ),
    ]);

  const emailOf = new Map(people.map((p) => [p.user.id, p.user.email]));

  return {
    exportedAt: new Date().toISOString(),
    note:
      "Everything Cira holds about this space. It does not include your apps' own data, " +
      "the values of their environment variables (Cira never stores them), what any " +
      "capability was called with, or their logs.",
    space: {
      name: space.name,
      address: `/${space.slug}`,
      joiningDomain: space.domain,
      plan: space.plan,
      subscription: space.subscriptionStatus,
      createdAt: space.createdAt.toISOString(),
    },
    people: people.map((p) => ({
      name: p.user.name,
      email: p.user.email,
      role: p.role,
      joinedAt: p.joined.toISOString(),
    })),
    teams: spaceTeams.map((team) => ({
      name: team.name,
      description: team.description,
      members: teamPeople.filter((m) => m.teamId === team.id).map((m) => m.email),
    })),
    invitations: pending
      .filter((invite) => invite.acceptedAt === null)
      .map((invite) => ({
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt.toISOString(),
      })),
    apps: ownApps.map((app) => ({
      name: app.name,
      address: `/${space.slug}/${app.slug}`,
      description: app.description,
      status: app.status,
      owner: emailOf.get(app.ownerUserId) ?? null,
      homepageUrl: app.homepageUrl,
      createdAt: app.createdAt.toISOString(),
      whoCanOpenIt: grants
        .filter((grant) => grant.appId === app.id)
        .map((grant) => ({ kind: grant.type, id: grant.targetId })),
      parts: parts
        .filter((part) => part.appId === app.id)
        .map((part) => ({
          name: part.slug,
          builtFrom: part.sourcePath === "" ? "the repository root" : part.sourcePath,
          dockerfile: part.dockerfile,
        })),
      capabilities: ops
        .filter((op) => op.appId === app.id)
        .map((op) => ({
          name: op.name,
          description: op.description,
          method: op.method,
          path: op.path,
          risk: op.risk,
          enabled: op.enabled,
          reach: op.reach,
        })),
      processes: background
        .filter((process) => process.appId === app.id)
        .map((process) => ({
          name: process.name,
          kind: process.kind,
          command: process.command,
          schedule: process.schedule,
          memoryMiB: process.memoryMiB,
          on: process.enabled,
          foundIn: process.source,
        })),
      environmentVariableNames: variables
        .filter((variable) => variable.appId === app.id)
        .map((variable) => variable.key),
      deploys: deploys
        .filter((deploy) => deploy.appId === app.id)
        .map((deploy) => ({
          status: deploy.status,
          servesWeb: deploy.servesWeb,
          at: deploy.createdAt.toISOString(),
        })),
    })),
  };
}
