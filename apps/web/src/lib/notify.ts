import "server-only";

import { and, eq, inArray, or } from "drizzle-orm";
import { apps, db, memberships, notifications, spaces, users } from "@cira/db";
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

export type NotifyOutcome = "sent" | "already-told" | "no-one-to-tell" | "not-sent";

/** The app, with the links a message points to. */
export interface NotifiedApp extends AppRef {
  logs: string;
}

export async function notifyManagers(args: {
  appId: string;
  kind: NotificationKind;
  /** Which event of that kind: a deployment id, a run id, a spell's start. */
  subject: string;
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

    const claimed = await database
      .insert(notifications)
      .values({
        id: newId("notification"),
        appId: args.appId,
        spaceId: row.app.spaceId,
        kind: args.kind,
        subject: args.subject,
      })
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    const claim = claimed[0];
    if (claim === undefined) return "already-told";

    const to = await managerEmails(row.app.spaceId, row.app.ownerUserId);
    if (to.length === 0) {
      await database
        .update(notifications)
        .set({ failure: "Nobody manages this app." })
        .where(eq(notifications.id, claim.id));
      return "no-one-to-tell";
    }

    const page = `${appOrigin()}/${row.spaceSlug}/${row.app.slug}`;
    const message = args.compose({
      name: row.app.name,
      spaceName: row.spaceName,
      page,
      logs: `${page}/logs`,
    });

    let sent = 0;
    let reason: string | null = null;
    for (const address of to) {
      const outcome = await sendEmail({ to: address, ...message });
      if (outcome.sent) sent += 1;
      else reason = outcome.reason;
    }

    await database
      .update(notifications)
      .set({
        recipients: sent,
        sentAt: sent > 0 ? new Date() : null,
        failure: sent === to.length ? null : REASONS[reason ?? "refused"],
      })
      .where(eq(notifications.id, claim.id));
    return sent > 0 ? "sent" : "not-sent";
  } catch (error) {
    console.warn(
      `notification ${args.kind} for ${args.appId} not sent: ${error instanceof Error ? error.name : "error"}`,
    );
    return "not-sent";
  }
}

const REASONS: Record<string, string> = {
  "not-configured": "Email is not configured for this Cira.",
  refused: "The email provider refused it.",
  unreachable: "The email provider could not be reached.",
};

/**
 * Who manages an app, by email: its owner while they are still in the space,
 * and the space's admins and owners - the same people `canManageApp` lets
 * change it.
 */
export async function managerEmails(
  spaceId: string,
  ownerUserId: string,
): Promise<string[]> {
  const rows = await db()
    .select({ email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.spaceId, spaceId),
        or(
          eq(memberships.userId, ownerUserId),
          inArray(memberships.role, ["admin", "owner"]),
        ),
      ),
    );
  return [...new Set(rows.map((r) => r.email.toLowerCase()))].sort();
}
