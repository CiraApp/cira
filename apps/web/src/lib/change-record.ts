import "server-only";

import { desc, eq } from "drizzle-orm";
import { db, spaceChanges } from "@cira/db";
import { newId } from "@cira/core";
import type { Change, ChangeKind } from "@cira/core";

/**
 * Writing down who changed what about a company.
 *
 * One function, called from the action that made the change, right after the
 * change landed - never before, so the record cannot claim something that did
 * not happen. It is deliberately not a trigger or a wrapper: what a change
 * *means* ("made Dana an admin", "let agents run Refund an order") is known at
 * the action and nowhere else, and a record written from table diffs would
 * have to guess it back.
 *
 * Recording must never be what stops a change. A failure here is reported to
 * Sentry and swallowed: an admin whose role change was refused because the
 * record could not be written would simply be an admin who cannot work.
 */
export async function record(change: {
  spaceId: string;
  kind: ChangeKind;
  /** Who did it, in words: usually a person's name. */
  actor: string;
  actorUserId?: string | null;
  /** What it was done to, in words. */
  subject: string;
  appId?: string | null;
  detail?: string | null;
}): Promise<void> {
  try {
    await db()
      .insert(spaceChanges)
      .values({
        id: newId("change"),
        spaceId: change.spaceId,
        kind: change.kind,
        actor: change.actor,
        actorUserId: change.actorUserId ?? null,
        subject: change.subject,
        appId: change.appId ?? null,
        detail: change.detail ?? null,
      });
  } catch (error) {
    const { captureException } = await import("@sentry/nextjs");
    captureException(error, { tags: { what: "change-record" } });
  }
}

/** What has been changed about a company, newest first. */
export async function changesIn(spaceId: string, limit = 100): Promise<Change[]> {
  const rows = await db()
    .select()
    .from(spaceChanges)
    .where(eq(spaceChanges.spaceId, spaceId))
    .orderBy(desc(spaceChanges.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    spaceId: row.spaceId,
    kind: row.kind as ChangeKind,
    actor: row.actor,
    actorUserId: row.actorUserId,
    subject: row.subject,
    appId: row.appId,
    detail: row.detail,
    at: row.createdAt,
  }));
}
