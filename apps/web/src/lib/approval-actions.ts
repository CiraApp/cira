"use server";

import { decide } from "@/lib/approvals";
import { requireCurrentUser } from "@/lib/identity";

export type DecisionResult = { ok: true } | { ok: false; error: string };

/** Approve, or decline, one change an assistant asked to make. */
export async function decideApproval(
  approvalId: string,
  answer: "approve" | "deny",
): Promise<DecisionResult> {
  if (answer !== "approve" && answer !== "deny") {
    return { ok: false, error: "That is not an answer Cira knows." };
  }
  const user = await requireCurrentUser();
  const done = await decide(user, approvalId, answer);
  return done
    ? { ok: true }
    : {
        ok: false,
        error: "This request is no longer waiting: it was answered, or it lapsed.",
      };
}
