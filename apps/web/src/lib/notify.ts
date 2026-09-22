import "server-only";

import { and, count, eq, gt, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import {
  appAccess,
  apps,
  db,
  memberships,
  notifications,
  spaces,
  teamMembers,
  users,
} from "@cira/db";
import { newId } from "@cira/core";
import { appOrigin, sendEmail } from "@/lib/email";
import type { AppRef, Message } from "@/lib/messages";

/**
 * Telling the people who manage an app that something happened to it.
 *
 * Each event is claimed before anything is sent, by writing its row under a
 * key that names it. Several paths can notice the same failure at once - the
 * CLI polling a deploy, someone opening the app's page, the watcher - and
 * only the one whose write lands sends; the rest find it taken. A claimed
 * event is never sent twice, even if sending it failed: a repeated email about
 * an old problem is worse than one that did not arrive.
 *
 * Never throws. Nothing that notices a failure should fail because telling
 * someone about it did.
 */

export type NotificationKind =
  "deploy-failed" | "app-down" | "app-back" | "run-failed" | "capability-refused";

/** Notices about a whole space, sent to its admins and owners. */
export type SpaceNoticeKind =
  | "trial-ending"
  | "trial-ended"
  | "plan-enforced"
  | "payment-failed"
  | "subscription-ended";

export type NotifyOutcome =
  "sent" | "already-told" | "no-one-to-tell" | "not-sent" | "held-back";

/** The app, with the links a message points to. */
export interface NotifiedApp extends AppRef {
  logs: string;
}

/**
 * How many emails one topic may cause in a window before the rest are held
 * back. An app flapping up and down, a worker crash-looping, or a job every
 * five minutes that keeps failing used to send one email per event - hundreds
 * a day, to every manager - which is how alerts stop being read.
 */
const HOLD: Partial<Record<NotificationKind, { max: number; withinMs: number }>> = {
  "app-down": { max: 2, withinMs: 2 * 3600_000 },
  "run-failed": { max: 1, withinMs: 6 * 3600_000 },
};

export async function notifyManagers(args: {
  appId: string;
  kind: NotificationKind;
  /** Which event of that kind: a deployment id, a run id, a spell's start. */
  subject: string;
  /** What it is about within the app - "web", "worker:x", "run:report" - for holding back floods. */
  topic?: string;
  compose: (app: NotifiedApp) => Message;
}): Promise<NotifyOutcome> {
  try {
    const database = db();
    const [row] = await database
      .select({ app: apps, spaceName: spaces.name, spaceSlug: spaces.slug })
      .from(apps)
      .innerJoin(spaces, eq(spaces.id, apps.spaceId))
      .where(eq(apps.id, args.appId))
      .limit(1);
    if (row === undefined) return "no-one-to-tell";

    const page = `${appOrigin()}/${row.spaceSlug}/${row.app.slug}`;
    const composed = args.compose({
      name: row.app.name,
      spaceName: row.spaceName,
      page,
      logs: `${page}/logs`,
    });

    const held = await holdBack(args);
    const to = held === null ? await managerEmails(row.app) : [];

    const claimed = await database
      .insert(notifications)
      .values({
        id: newId("notification"),
        appId: args.appId,
        spaceId: row.app.spaceId,
        kind: args.kind,
        subject: args.subject,
        topic: args.topic ?? null,
        message: composed,
        unsent: to,
        failure: held,
      })
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    const claim = claimed[0];
    if (claim === undefined) return "already-told";
    if (held !== null) return "held-back";

    if (to.length === 0) {
      await database
        .update(notifications)
        .set({ failure: "Nobody manages this app." })
        .where(eq(notifications.id, claim.id));
      return "no-one-to-tell";
    }

    return await deliver(claim.id, composed, to);
  } catch (error) {
    console.warn(
      `notification ${args.kind} for ${args.appId} not sent: ${error instanceof Error ? error.name : "error"}`,
    );
    return "not-sent";
  }
}

/**
 * Tell a space's admins and owners something about the space itself: its
 * trial, its payments, what its plan stopped running. Claimed once per space,
 * kind and subject, the same way an app's notices are.
 */
export async function notifyAdmins(args: {
  spaceId: string;
  kind: SpaceNoticeKind;
  subject: string;
  compose: (space: { name: string; billing: string }) => Message;
}): Promise<NotifyOutcome> {
  try {
    const database = db();
    const [space] = await database
      .select({ id: spaces.id, name: spaces.name, slug: spaces.slug })
      .from(spaces)
      .where(eq(spaces.id, args.spaceId))
      .limit(1);
    if (space === undefined) return "no-one-to-tell";

    const composed = args.compose({
      name: space.name,
      billing: `${appOrigin()}/${space.slug}/~/usage`,
    });
    const to = await adminEmails(space.id);

    const claimed = await database
      .insert(notifications)
      .values({
        id: newId("notification"),
        appId: null,
        spaceId: space.id,
        kind: args.kind,
        subject: args.subject,
        message: composed,
        unsent: to,
      })
      .onConflictDoNothing({
        target: [notifications.spaceId, notifications.kind, notifications.subject],
        where: sql`${notifications.appId} IS NULL`,
      })
      .returning({ id: notifications.id });
    const claim = claimed[0];
    if (claim === undefined) return "already-told";
    if (to.length === 0) return "no-one-to-tell";

    return await deliver(claim.id, composed, to);
  } catch (error) {
    console.warn(
      `space notice ${args.kind} not sent: ${error instanceof Error ? error.name : "error"}`,
    );
    return "not-sent";
  }
}

/**
 * Try again with every notice that did not reach everyone: the provider was
 * down, or refused. A notice used to be claimed and then lost for good. Given
 * up on after five tries or a day, when it is old news.
 */
export async function retryUnsent(now: Date = new Date()): Promise<number> {
  const database = db();
  const waiting = await database
    .select({
      id: notifications.id,
      message: notifications.message,
      unsent: notifications.unsent,
    })
    .from(notifications)
    .where(
      and(
        sql`cardinality(${notifications.unsent}) > 0`,
        lt(notifications.attempts, MAX_ATTEMPTS),
        gt(notifications.createdAt, new Date(now.getTime() - 24 * 3600_000)),
      ),
    )
    .limit(50);

  let delivered = 0;
  for (const row of waiting) {
    if (row.message === null) continue;
    if ((await deliver(row.id, row.message, row.unsent)) === "sent") delivered += 1;
  }
  return delivered;
}

const MAX_ATTEMPTS = 5;

/** Send to each address still waiting, and write down who has it now. */
async function deliver(
  id: string,
  message: Message,
  to: readonly string[],
): Promise<NotifyOutcome> {
  const still: string[] = [];
  let reason: string | null = null;
  let sent = 0;
  for (const address of to) {
    const outcome = await sendEmail({ to: address, ...message });
    if (outcome.sent) sent += 1;
    else {
      still.push(address);
      reason = outcome.reason;
    }
  }

  await db()
    .update(notifications)
    .set({
      recipients: sql`${notifications.recipients} + ${sent}`,
      unsent: still,
      attempts: sql`${notifications.attempts} + 1`,
      sentAt: still.length === 0 ? new Date() : null,
      failure: still.length === 0 ? null : REASONS[reason ?? "refused"],
    })
    .where(eq(notifications.id, id));
  return still.length === 0 ? "sent" : "not-sent";
}

/**
 * Why this one is not to be sent, or null when it is. Recorded on the row,
 * so a notice held back is still a fact anyone can find.
 */
async function holdBack(args: {
  appId: string;
  kind: NotificationKind;
  subject: string;
  topic?: string;
}): Promise<string | null> {
  const database = db();

  // Back up, after an outage nobody was told about, is not news either.
  if (args.kind === "app-back") {
    const [down] = await database
      .select({ sentAt: notifications.sentAt })
      .from(notifications)
      .where(
        and(
          eq(notifications.appId, args.appId),
          eq(notifications.kind, "app-down"),
          eq(notifications.subject, args.subject),
        ),
      )
      .limit(1);
    return down?.sentAt === null || down === undefined
      ? "Held back: nobody was told it went down."
      : null;
  }

  const rule = HOLD[args.kind];
  if (rule === undefined || args.topic === undefined) return null;
  const [recent] = await database
    .select({ n: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.appId, args.appId),
        eq(notifications.kind, args.kind),
        eq(notifications.topic, args.topic),
        isNotNull(notifications.sentAt),
        gt(notifications.createdAt, new Date(Date.now() - rule.withinMs)),
      ),
    );
  return (recent?.n ?? 0) >= rule.max
    ? `Held back: already told about this ${rule.max === 1 ? "once" : `${rule.max} times`} lately.`
    : null;
}

/** A space's admins and owners, by email. */
async function adminEmails(spaceId: string): Promise<string[]> {
  const rows = await db()
    .select({ email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.spaceId, spaceId),
        inArray(memberships.role, ["admin", "owner"]),
      ),
    );
  return [...new Set(rows.map((r) => r.email.toLowerCase()))].sort();
}

const REASONS: Record<string, string> = {
  "not-configured": "Email is not configured for this Cira.",
  refused: "The email provider refused it.",
  unreachable: "The email provider could not be reached.",
};

/**
 * Who manages an app, by email: its owner while they are still in the space,
 * the space's admins and owners, and anyone given `manage` on it directly or
 * through a team - the same people `canManageApp` lets change it.
 */
export async function managerEmails(app: {
  id: string;
  spaceId: string;
  ownerUserId: string;
}): Promise<string[]> {
  const database = db();

  const grants = await database
    .select({ type: appAccess.type, targetId: appAccess.targetId })
    .from(appAccess)
    .where(and(eq(appAccess.appId, app.id), eq(appAccess.level, "manage")));
  const people = grants.filter((g) => g.type === "user").map((g) => g.targetId);
  const teams = grants.filter((g) => g.type === "team").map((g) => g.targetId);
  const onTeams =
    teams.length === 0
      ? []
      : await database
          .select({ userId: teamMembers.userId })
          .from(teamMembers)
          .where(inArray(teamMembers.teamId, teams));
  const granted = [...people, ...onTeams.map((t) => t.userId)];

  // Still in the space, always: a grant outliving someone's membership must
  // not keep sending them the company's alerts.
  const rows = await database
    .select({ email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.spaceId, app.spaceId),
        or(
          eq(memberships.userId, app.ownerUserId),
          inArray(memberships.role, ["admin", "owner"]),
          ...(granted.length > 0 ? [inArray(memberships.userId, granted)] : []),
        ),
      ),
    );
  return [...new Set(rows.map((r) => r.email.toLowerCase()))].sort();
}
