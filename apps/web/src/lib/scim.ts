import "server-only";

import { randomBytes } from "node:crypto";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import {
  appAccess,
  db,
  memberships,
  scimGroupMembers,
  scimGroups,
  scimUsers,
  spaceJoinBlocks,
  spaceScim,
  spaceSso,
  spaces,
  teamMembers,
  teams,
  users,
} from "@cira/db";
import { newId, slugify, slugWithSuffix, type User } from "@cira/core";
import { hashToken } from "@/lib/token-hash";
import { record } from "@/lib/change-record";
import { depart } from "@/lib/departure";
import { emailDomain, isPublicEmailDomain } from "@/lib/email-domain";
import {
  SCHEMA,
  ScimError,
  type GroupInput,
  type GroupPatch,
  type UserInput,
  type UserPatch,
} from "@/lib/scim-protocol";

/**
 * A company's identity provider keeping its people in step with Cira.
 *
 * Someone added in Okta can use Cira the first time they sign in, without
 * waiting for an invite; someone deactivated there is out of Cira on the next
 * push, with every grant and team seat gone, and cannot come back by domain.
 * Groups arrive as Cira teams, so when someone moves teams in the company's
 * directory, the apps they can open move with them.
 *
 * A person is kept by address. The identity provider knows nothing of Cira's
 * users, and Cira may not have one yet - so a provisioned person is a promise
 * until they sign in, which is when it is kept (`claimProvisioned`).
 */

type ScimUserRow = typeof scimUsers.$inferSelect;
type ScimGroupRow = typeof scimGroups.$inferSelect;

/** The base every identity provider is given. */
export const SCIM_PATH = "/api/scim/v2";

// ----- Whose people -------------------------------------------------------

/**
 * The email domains a company has shown it holds, and so the only people its
 * directory may put in it: the domain the space was founded on, which came
 * from a verified address there, and the one it set up single sign-on for,
 * which takes an address there too. Never a provider anyone can sign up at.
 *
 * Without this, directory sync was a way into someone else's account list:
 * any admin of any space - a trial made a minute ago - could push
 * someone@bigco.com over SCIM, and that person, already on Cira or the next
 * time they signed in, became a member with no invitation and nothing to
 * accept. Every other way into a company needs the person's own address at
 * its domain, or their own consent; this one now does too.
 */
export async function directoryDomains(spaceId: string): Promise<string[]> {
  const [space] = await db()
    .select({ domain: spaces.domain })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1);
  const [sso] = await db()
    .select({ domain: spaceSso.domain })
    .from(spaceSso)
    .where(eq(spaceSso.spaceId, spaceId))
    .limit(1);
  const found = [space?.domain, sso?.domain]
    .filter((d): d is string => typeof d === "string" && d !== "")
    .map((d) => d.toLowerCase())
    .filter((d) => !isPublicEmailDomain(d));
  return [...new Set(found)];
}

/** Refuse, in SCIM's own terms, a person at a domain the company has not shown. */
async function mustBeOurs(spaceId: string, userName: string): Promise<void> {
  const domain = emailDomain(userName);
  const ours = await directoryDomains(spaceId);
  if (domain === null || !ours.includes(domain)) {
    throw new ScimError(
      400,
      ours.length === 0
        ? "This company has no domain of its own, so its directory cannot add anyone."
        : `${userName} is not at ${ours.map((d) => `@${d}`).join(" or ")}, so this directory cannot add them.`,
      "invalidValue",
    );
  }
}

// ----- The token ---------------------------------------------------------

/** A new token for the space, replacing any before it. Shown once. */
export async function issueScimToken(spaceId: string, userId: string): Promise<string> {
  const token = `cira_scim_${randomBytes(32).toString("hex")}`;
  await db()
    .insert(spaceScim)
    .values({ spaceId, tokenHash: hashToken(token), createdByUserId: userId })
    .onConflictDoUpdate({
      target: spaceScim.spaceId,
      set: {
        tokenHash: hashToken(token),
        createdByUserId: userId,
        createdAt: new Date(),
        lastUsedAt: null,
      },
    });
  return token;
}

export async function revokeScim(spaceId: string): Promise<void> {
  await db().delete(spaceScim).where(eq(spaceScim.spaceId, spaceId));
}

export async function scimStatus(
  spaceId: string,
): Promise<{ createdAt: Date; lastUsedAt: Date | null; people: number } | null> {
  const [row] = await db()
    .select()
    .from(spaceScim)
    .where(eq(spaceScim.spaceId, spaceId))
    .limit(1);
  if (row === undefined) return null;
  const [people] = await db()
    .select({ n: count() })
    .from(scimUsers)
    .where(and(eq(scimUsers.spaceId, spaceId), eq(scimUsers.active, true)));
  return { createdAt: row.createdAt, lastUsedAt: row.lastUsedAt, people: people?.n ?? 0 };
}

/** The space a bearer token speaks for, or null. */
export async function spaceForToken(
  authorization: string | null,
): Promise<string | null> {
  const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? "")?.[1];
  if (token === undefined) return null;
  const [row] = await db()
    .select({ spaceId: spaceScim.spaceId })
    .from(spaceScim)
    .where(eq(spaceScim.tokenHash, hashToken(token)))
    .limit(1);
  if (row === undefined) return null;
  await db()
    .update(spaceScim)
    .set({ lastUsedAt: new Date() })
    .where(eq(spaceScim.spaceId, row.spaceId));
  return row.spaceId;
}

// ----- Users ---------------------------------------------------------------

export function userResource(row: ScimUserRow, origin: string) {
  const formatted = [row.givenName, row.familyName].filter(Boolean).join(" ");
  return {
    schemas: [SCHEMA.user],
    id: row.id,
    ...(row.externalId === null ? {} : { externalId: row.externalId }),
    userName: row.userName,
    name: {
      ...(row.givenName === null ? {} : { givenName: row.givenName }),
      ...(row.familyName === null ? {} : { familyName: row.familyName }),
      ...(formatted === "" ? {} : { formatted }),
    },
    ...(formatted === "" ? {} : { displayName: formatted }),
    emails: [{ value: row.userName, primary: true, type: "work" }],
    active: row.active,
    meta: {
      resourceType: "User",
      created: row.createdAt.toISOString(),
      lastModified: row.updatedAt.toISOString(),
      location: `${origin}${SCIM_PATH}/Users/${row.id}`,
    },
  };
}

export async function listUsers(
  spaceId: string,
  filter: { attribute: string; value: string } | null,
  startIndex: number,
  limit: number,
): Promise<{ rows: ScimUserRow[]; total: number }> {
  const where = and(
    eq(scimUsers.spaceId, spaceId),
    filter === null
      ? undefined
      : filter.attribute === "username"
        ? eq(scimUsers.userName, filter.value.toLowerCase())
        : filter.attribute === "externalid"
          ? eq(scimUsers.externalId, filter.value)
          : filter.attribute === "emails.value"
            ? eq(scimUsers.userName, filter.value.toLowerCase())
            : eq(scimUsers.id, "\u0000"),
  );
  const [total] = await db().select({ n: count() }).from(scimUsers).where(where);
  const rows = await db()
    .select()
    .from(scimUsers)
    .where(where)
    .orderBy(asc(scimUsers.createdAt))
    .offset(Math.max(0, startIndex - 1))
    .limit(limit);
  return { rows, total: total?.n ?? 0 };
}

export async function getUser(spaceId: string, id: string): Promise<ScimUserRow> {
  const [row] = await db()
    .select()
    .from(scimUsers)
    .where(and(eq(scimUsers.spaceId, spaceId), eq(scimUsers.id, id)))
    .limit(1);
  if (row === undefined) throw new ScimError(404, "No such user.");
  return row;
}

export async function createUser(
  spaceId: string,
  input: UserInput,
): Promise<ScimUserRow> {
  await mustBeOurs(spaceId, input.userName);
  const [taken] = await db()
    .select({ id: scimUsers.id })
    .from(scimUsers)
    .where(and(eq(scimUsers.spaceId, spaceId), eq(scimUsers.userName, input.userName)))
    .limit(1);
  if (taken !== undefined) {
    throw new ScimError(409, `${input.userName} is already provisioned.`, "uniqueness");
  }
  const [row] = await db()
    .insert(scimUsers)
    .values({ id: newId("scimUser"), spaceId, ...input })
    .returning();
  await reconcileUser(row!);
  return getUser(spaceId, row!.id);
}

export async function replaceUser(
  spaceId: string,
  id: string,
  input: UserInput,
): Promise<ScimUserRow> {
  await getUser(spaceId, id);
  return updateUser(spaceId, id, input);
}

export async function patchUser(
  spaceId: string,
  id: string,
  patch: UserPatch,
): Promise<ScimUserRow> {
  await getUser(spaceId, id);
  return updateUser(spaceId, id, patch);
}

async function updateUser(
  spaceId: string,
  id: string,
  change: Partial<UserInput>,
): Promise<ScimUserRow> {
  const before = await getUser(spaceId, id);
  if (change.userName !== undefined && change.userName !== before.userName) {
    await mustBeOurs(spaceId, change.userName);
  }
  // A new address is a different person as far as Cira's members go: the one
  // who held the old address is taken out, then the new one reconciled.
  if (change.userName !== undefined && change.userName !== before.userName) {
    await reconcileUser({ ...before, active: false });
    await db().update(scimUsers).set({ userId: null }).where(eq(scimUsers.id, id));
  }
  await db()
    .update(scimUsers)
    .set({ ...change, updatedAt: new Date() })
    .where(eq(scimUsers.id, id));
  const after = await getUser(spaceId, id);
  await reconcileUser(after);
  return getUser(spaceId, id);
}

export async function deleteUser(spaceId: string, id: string): Promise<void> {
  const row = await getUser(spaceId, id);
  await reconcileUser({ ...row, active: false });
  await db().delete(scimUsers).where(eq(scimUsers.id, id));
}

/**
 * Make Cira match what the identity provider says about one person: a member
 * while active, in the teams their groups are; out, and kept out, when not.
 */
async function reconcileUser(row: ScimUserRow): Promise<void> {
  const database = db();
  const [user] = await database
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, row.userName))
    .limit(1);
  if (user === undefined) return; // Kept at their first sign-in.

  if (row.userId !== user.id) {
    await database
      .update(scimUsers)
      .set({ userId: user.id })
      .where(eq(scimUsers.id, row.id));
  }

  const [membership] = await database
    .select({ id: memberships.id, role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.spaceId, row.spaceId), eq(memberships.userId, user.id)))
    .limit(1);

  // Checked again here, not only when the directory sends someone: rows made
  // before the rule existed must not be the way around it. Taking someone
  // out never needs this - only letting them in does.
  if (
    row.active &&
    !(await directoryDomains(row.spaceId)).includes(emailDomain(row.userName) ?? "")
  ) {
    return;
  }

  if (row.active) {
    // The directory decides now: an address someone once removed by hand is
    // let back in when the company's own provider says they work there.
    await database
      .delete(spaceJoinBlocks)
      .where(
        and(
          eq(spaceJoinBlocks.spaceId, row.spaceId),
          eq(spaceJoinBlocks.email, row.userName),
        ),
      );
    if (membership === undefined) {
      await database
        .insert(memberships)
        .values({
          id: newId("membership"),
          userId: user.id,
          spaceId: row.spaceId,
          role: "member",
        })
        .onConflictDoNothing();
      // No person did this, and saying an admin did would be untrue: the
      // company's own directory assigned them, and the record says so.
      await record({
        spaceId: row.spaceId,
        kind: "member-joined",
        actor: "your directory",
        subject: row.userName,
        detail: "as member, from your identity provider",
      });
    }
    await syncTeamsFor(row.id, user.id);
    return;
  }

  if (membership === undefined) return;
  const owners = await database
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.spaceId, row.spaceId), eq(memberships.role, "owner")))
    .orderBy(asc(memberships.createdAt));
  const heir = owners.find((owner) => owner.userId !== user.id);
  // A space is never left without an owner: the last one stays until a person
  // makes someone else owner, whatever the directory says.
  if (heir === undefined) return;
  await depart({
    spaceId: row.spaceId,
    membershipId: membership.id,
    userId: user.id,
    email: row.userName,
    heir: heir.userId,
    blockRejoin: true,
  });
  await record({
    spaceId: row.spaceId,
    kind: "member-removed",
    actor: "your directory",
    subject: row.userName,
    detail: "deactivated in your identity provider",
  });
}

/**
 * Keep a promise made before someone had a Cira account: called when a person
 * first signs in, for every company whose directory already has them.
 */
export async function claimProvisioned(user: User): Promise<void> {
  const rows = await db()
    .select()
    .from(scimUsers)
    .where(
      and(eq(scimUsers.userName, user.email.toLowerCase()), eq(scimUsers.active, true)),
    );
  for (const row of rows) await reconcileUser(row);
}

// ----- Groups ------------------------------------------------------------

export async function groupResource(row: ScimGroupRow, origin: string) {
  const members = await db()
    .select({ id: scimUsers.id, userName: scimUsers.userName })
    .from(scimGroupMembers)
    .innerJoin(scimUsers, eq(scimUsers.id, scimGroupMembers.scimUserId))
    .where(eq(scimGroupMembers.groupId, row.id));
  return {
    schemas: [SCHEMA.group],
    id: row.id,
    ...(row.externalId === null ? {} : { externalId: row.externalId }),
    displayName: row.displayName,
    members: members.map((m) => ({
      value: m.id,
      display: m.userName,
      $ref: `${origin}${SCIM_PATH}/Users/${m.id}`,
    })),
    meta: {
      resourceType: "Group",
      created: row.createdAt.toISOString(),
      location: `${origin}${SCIM_PATH}/Groups/${row.id}`,
    },
  };
}

export async function listGroups(
  spaceId: string,
  filter: { attribute: string; value: string } | null,
  startIndex: number,
  limit: number,
): Promise<{ rows: ScimGroupRow[]; total: number }> {
  const where = and(
    eq(scimGroups.spaceId, spaceId),
    filter === null
      ? undefined
      : filter.attribute === "displayname"
        ? eq(scimGroups.displayName, filter.value)
        : filter.attribute === "externalid"
          ? eq(scimGroups.externalId, filter.value)
          : eq(scimGroups.id, "\u0000"),
  );
  const [total] = await db().select({ n: count() }).from(scimGroups).where(where);
  const rows = await db()
    .select()
    .from(scimGroups)
    .where(where)
    .orderBy(asc(scimGroups.createdAt))
    .offset(Math.max(0, startIndex - 1))
    .limit(limit);
  return { rows, total: total?.n ?? 0 };
}

export async function getGroup(spaceId: string, id: string): Promise<ScimGroupRow> {
  const [row] = await db()
    .select()
    .from(scimGroups)
    .where(and(eq(scimGroups.spaceId, spaceId), eq(scimGroups.id, id)))
    .limit(1);
  if (row === undefined) throw new ScimError(404, "No such group.");
  return row;
}

export async function createGroup(
  spaceId: string,
  input: GroupInput,
): Promise<ScimGroupRow> {
  const database = db();
  const teamId = newId("team");
  await database.insert(teams).values({
    id: teamId,
    spaceId,
    name: input.displayName,
    slug: await freeTeamSlug(spaceId, slugify(input.displayName) || "team"),
    description: "Kept in step by the company's identity provider.",
  });
  const [row] = await database
    .insert(scimGroups)
    .values({
      id: newId("scimGroup"),
      spaceId,
      externalId: input.externalId,
      displayName: input.displayName,
      teamId,
    })
    .returning();
  await setMembers(row!, input.members);
  return row!;
}

export async function replaceGroup(
  spaceId: string,
  id: string,
  input: GroupInput,
): Promise<ScimGroupRow> {
  const row = await getGroup(spaceId, id);
  await rename(row, input.displayName);
  await db()
    .update(scimGroups)
    .set({ externalId: input.externalId })
    .where(eq(scimGroups.id, id));
  await setMembers(row, input.members);
  return getGroup(spaceId, id);
}

export async function patchGroup(
  spaceId: string,
  id: string,
  patch: GroupPatch,
): Promise<ScimGroupRow> {
  const row = await getGroup(spaceId, id);
  if (patch.displayName !== undefined) await rename(row, patch.displayName);
  if (patch.replace !== undefined) {
    await setMembers(row, patch.replace);
  } else {
    const current = await memberIdsOf(row.id);
    const next = new Set(current);
    for (const id of patch.add) next.add(id);
    for (const id of patch.remove) next.delete(id);
    await setMembers(row, [...next]);
  }
  return getGroup(spaceId, id);
}

/** The group goes, and its team with it - and every app grant that team held. */
export async function deleteGroup(spaceId: string, id: string): Promise<void> {
  const row = await getGroup(spaceId, id);
  await db()
    .delete(appAccess)
    .where(and(eq(appAccess.type, "team"), eq(appAccess.targetId, row.teamId)));
  await db().delete(teams).where(eq(teams.id, row.teamId));
}

async function rename(row: ScimGroupRow, displayName: string): Promise<void> {
  if (displayName === row.displayName) return;
  await db().update(scimGroups).set({ displayName }).where(eq(scimGroups.id, row.id));
  await db().update(teams).set({ name: displayName }).where(eq(teams.id, row.teamId));
}

async function memberIdsOf(groupId: string): Promise<string[]> {
  const rows = await db()
    .select({ id: scimGroupMembers.scimUserId })
    .from(scimGroupMembers)
    .where(eq(scimGroupMembers.groupId, groupId));
  return rows.map((row) => row.id);
}

/** The group's members, and its team's, exactly as the directory says. */
async function setMembers(
  row: ScimGroupRow,
  scimUserIds: readonly string[],
): Promise<void> {
  const database = db();
  const known =
    scimUserIds.length === 0
      ? []
      : await database
          .select({
            id: scimUsers.id,
            userId: scimUsers.userId,
            active: scimUsers.active,
          })
          .from(scimUsers)
          .where(
            and(
              eq(scimUsers.spaceId, row.spaceId),
              inArray(scimUsers.id, [...scimUserIds]),
            ),
          );

  await database.delete(scimGroupMembers).where(eq(scimGroupMembers.groupId, row.id));
  if (known.length > 0) {
    await database
      .insert(scimGroupMembers)
      .values(known.map((user) => ({ groupId: row.id, scimUserId: user.id })))
      .onConflictDoNothing();
  }

  // The team holds the people who are in the group and are members now;
  // anyone else joins it when they are.
  const seated = known
    .filter((user) => user.active && user.userId !== null)
    .map((user) => user.userId!);
  const inSpace =
    seated.length === 0
      ? []
      : await database
          .select({ userId: memberships.userId })
          .from(memberships)
          .where(
            and(
              eq(memberships.spaceId, row.spaceId),
              inArray(memberships.userId, seated),
            ),
          );
  await database.delete(teamMembers).where(eq(teamMembers.teamId, row.teamId));
  if (inSpace.length > 0) {
    await database
      .insert(teamMembers)
      .values(
        inSpace.map((m) => ({
          id: newId("teamMember"),
          teamId: row.teamId,
          userId: m.userId,
        })),
      )
      .onConflictDoNothing();
  }
}

/** One person's seats in the teams their pushed groups keep. */
async function syncTeamsFor(scimUserId: string, userId: string): Promise<void> {
  const groups = await db()
    .select({ teamId: scimGroups.teamId })
    .from(scimGroupMembers)
    .innerJoin(scimGroups, eq(scimGroups.id, scimGroupMembers.groupId))
    .where(eq(scimGroupMembers.scimUserId, scimUserId));
  if (groups.length === 0) return;
  await db()
    .insert(teamMembers)
    .values(groups.map((g) => ({ id: newId("teamMember"), teamId: g.teamId, userId })))
    .onConflictDoNothing();
}

async function freeTeamSlug(spaceId: string, base: string): Promise<string> {
  for (let attempt = 1; attempt <= 25; attempt += 1) {
    const candidate = attempt === 1 ? base : slugWithSuffix(base, String(attempt));
    const [taken] = await db()
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.spaceId, spaceId), eq(teams.slug, candidate)))
      .limit(1);
    if (taken === undefined) return candidate;
  }
  return slugWithSuffix(base, newId("team").slice(-6));
}
