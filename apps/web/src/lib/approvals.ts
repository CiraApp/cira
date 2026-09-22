import "server-only";

import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { approvals, db } from "@cira/db";
import { newId, type User } from "@cira/core";
import type { InvocationVia } from "@/lib/invoke-capability";

/**
 * A person agreeing, in Cira, to one change an assistant wants to make.
 *
 * Cira's promise is that anything that changes data waits for the person it
 * acts for. Ask Cira and the console always kept it; MCP did not - a write
 * ran as soon as an assistant asked, and the only check was whatever the
 * assistant's own client did, which is nothing once someone has clicked
 * "always allow". Now the first ask records what the assistant wants to do
 * and hands back a link; the person approves it on a page in Cira; and the
 * assistant's second ask, carrying the approval's id, runs it.
 *
 * An approval is for one person, one capability and one input - compared by
 * hash, so an assistant cannot be approved for one refund and send another -
 * works once, and lapses after fifteen minutes.
 */

export const APPROVAL_MINUTES = 15;

/** The same input, written the same way, whatever order its keys came in. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function inputHash(input: unknown): string {
  return createHash("sha256").update(canonical(input), "utf8").digest("hex");
}

/** Record what an assistant wants to do, for its person to decide on. */
export async function requestApproval(args: {
  user: User;
  capabilityId: string;
  input: Record<string, unknown>;
  via: InvocationVia;
  now?: Date;
}): Promise<string> {
  const now = args.now ?? new Date();
  const id = newId("approval");
  await db()
    .insert(approvals)
    .values({
      id,
      userId: args.user.id,
      capabilityId: args.capabilityId,
      input: args.input,
      inputHash: inputHash(args.input),
      via: args.via,
      expiresAt: new Date(now.getTime() + APPROVAL_MINUTES * 60_000),
    });
  return id;
}

export type Consumed =
  | { ok: true }
  | {
      ok: false;
      reason: "missing" | "pending" | "denied" | "used" | "expired" | "different";
    };

/**
 * Spend an approval on the call it was given for. Atomic: the row moves from
 * approved to used in the same write that checks it, so two calls racing with
 * one approval run once.
 */
export async function consumeApproval(args: {
  user: User;
  approvalId: string;
  capabilityId: string;
  input: Record<string, unknown>;
  now?: Date;
}): Promise<Consumed> {
  const now = args.now ?? new Date();
  const database = db();
  const [row] = await database
    .select()
    .from(approvals)
    .where(and(eq(approvals.id, args.approvalId), eq(approvals.userId, args.user.id)))
    .limit(1);
  if (row === undefined || row.capabilityId !== args.capabilityId) {
    return { ok: false, reason: "missing" };
  }
  if (row.inputHash !== inputHash(args.input)) return { ok: false, reason: "different" };
  if (row.status === "used") return { ok: false, reason: "used" };
  if (row.status === "denied") return { ok: false, reason: "denied" };
  if (row.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  if (row.status === "pending") return { ok: false, reason: "pending" };

  const spent = await database
    .update(approvals)
    .set({ status: "used", usedAt: now })
    .where(
      and(
        eq(approvals.id, row.id),
        eq(approvals.status, "approved"),
        isNull(approvals.usedAt),
        gt(approvals.expiresAt, now),
      ),
    )
    .returning({ id: approvals.id });
  return spent.length === 1 ? { ok: true } : { ok: false, reason: "used" };
}

/** What each refusal means to the assistant, which relays it to its person. */
export const NOT_YET: Record<Exclude<Consumed, { ok: true }>["reason"], string> = {
  missing:
    "There is no approval with that id for this capability. Ask again without one.",
  pending:
    "The person has not approved this yet. Ask them to open the approval link, then call again with the same input and approvalId.",
  denied: "The person declined this. Do not try it again unless they ask you to.",
  used: "That approval has already been used. Each approval runs one call; ask again without it.",
  expired: `That approval lapsed after ${APPROVAL_MINUTES} minutes. Ask again without it for a new one.`,
  different:
    "That approval was for different input. An approval covers exactly what was shown to the person; ask again without it.",
};

export interface ApprovalView {
  id: string;
  status: "pending" | "approved" | "denied" | "used" | "expired";
  expiresAt: Date;
  via: string;
  input: Record<string, unknown>;
  capability: {
    name: string;
    description: string;
    method: string;
    path: string;
    appName: string;
    appSlug: string;
    spaceSlug: string;
  };
}

/**
 * One approval, for the page where its person decides on it. Null for anyone
 * else's, and for one whose capability they can no longer reach, which read
 * alike, so a guessed id says nothing.
 */
export async function loadApproval(
  user: User,
  approvalId: string,
  now: Date = new Date(),
): Promise<ApprovalView | null> {
  const [row] = await db()
    .select()
    .from(approvals)
    .where(and(eq(approvals.id, approvalId), eq(approvals.userId, user.id)))
    .limit(1);
  if (row === undefined) return null;

  const { getCapabilityForUser } = await import("@/lib/capabilities");
  const capability = await getCapabilityForUser(user, row.capabilityId);
  if (capability === null) return null;

  const lapsed =
    (row.status === "pending" || row.status === "approved") &&
    row.expiresAt.getTime() <= now.getTime();
  return {
    id: row.id,
    status: lapsed ? "expired" : row.status,
    expiresAt: row.expiresAt,
    via: row.via,
    input: row.input,
    capability: {
      name: capability.name,
      description: capability.description,
      method: capability.target.method,
      path: capability.target.path,
      appName: capability.appName,
      appSlug: capability.appSlug,
      spaceSlug: capability.spaceSlug,
    },
  };
}

/** The person's answer. Only theirs, only while it is waiting, only in time. */
export async function decide(
  user: User,
  approvalId: string,
  answer: "approve" | "deny",
  now: Date = new Date(),
): Promise<boolean> {
  const changed = await db()
    .update(approvals)
    .set({ status: answer === "approve" ? "approved" : "denied", decidedAt: now })
    .where(
      and(
        eq(approvals.id, approvalId),
        eq(approvals.userId, user.id),
        eq(approvals.status, "pending"),
        gt(approvals.expiresAt, now),
      ),
    )
    .returning({ id: approvals.id });
  return changed.length === 1;
}
