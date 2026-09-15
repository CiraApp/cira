"use server";

import { and, eq, isNull } from "drizzle-orm";
import { cliAuthRequests, db } from "@cira/db";
import { requireCurrentUser } from "@/lib/identity";
import { loginState, normaliseUserCode } from "@/lib/cli-auth";

export type ApproveResult = { ok: true; label: string } | { ok: false; error: string };

/**
 * Approve a waiting `cira login`.
 *
 * The person approving is taken from their session, never from the form, so
 * the code alone authorises nothing: whoever types it grants access to their
 * own account and no one else's.
 */
export async function approveCliLogin(rawCode: string): Promise<ApproveResult> {
  const user = await requireCurrentUser();

  const code = normaliseUserCode(rawCode);
  if (code === null) {
    return { ok: false, error: "That code does not look right. Check and try again." };
  }

  const database = db();

  const [row] = await database
    .select()
    .from(cliAuthRequests)
    .where(eq(cliAuthRequests.userCode, code))
    .limit(1);

  if (row === undefined) {
    return { ok: false, error: "We could not find that code. It may have expired." };
  }

  const state = loginState(row);
  if (state.status === "expired") {
    return { ok: false, error: "That code has expired. Run cira login again." };
  }
  if (state.status !== "pending") {
    return { ok: false, error: "That code has already been used." };
  }

  // Only the first approval counts, so a code cannot be bound to two accounts.
  const updated = await database
    .update(cliAuthRequests)
    .set({ approvedByUserId: user.id, approvedAt: new Date() })
    .where(and(eq(cliAuthRequests.id, row.id), isNull(cliAuthRequests.approvedAt)))
    .returning({ id: cliAuthRequests.id });

  if (updated.length === 0) {
    return { ok: false, error: "That code has already been used." };
  }

  return { ok: true, label: row.label };
}
