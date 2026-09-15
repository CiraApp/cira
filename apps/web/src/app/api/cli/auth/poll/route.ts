import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { cliAuthRequests, cliTokens, db, users } from "@cira/db";
import { newId } from "@cira/core";
import { hashToken, loginState, newCliToken } from "@/lib/cli-auth";

const body = z.object({ deviceCode: z.string().min(32).max(128) });

/**
 * The CLI asks whether its login has been approved yet.
 *
 * A token is handed over exactly once. The request is marked claimed in the
 * same step, so a replayed poll, or a second process holding the same device
 * code, gets nothing.
 */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ status: "invalid" }, { status: 400 });
  }

  const database = db();

  const [row] = await database
    .select()
    .from(cliAuthRequests)
    .where(eq(cliAuthRequests.deviceCode, parsed.data.deviceCode))
    .limit(1);

  // An unknown device code is indistinguishable from an expired one, so
  // polling cannot be used to learn which codes exist.
  if (row === undefined) return NextResponse.json({ status: "expired" });

  const state = loginState(row);
  if (state.status !== "approved" || row.approvedByUserId === null) {
    return NextResponse.json({ status: state.status });
  }

  // Claim first. If two polls race, only the one that flips claimedAt from
  // null proceeds to mint a token.
  const claimed = await database
    .update(cliAuthRequests)
    .set({ claimedAt: new Date() })
    .where(and(eq(cliAuthRequests.id, row.id), isNull(cliAuthRequests.claimedAt)))
    .returning({ id: cliAuthRequests.id });

  if (claimed.length === 0) return NextResponse.json({ status: "claimed" });

  const token = newCliToken();
  await database.insert(cliTokens).values({
    id: newId("invite"),
    userId: row.approvedByUserId,
    tokenHash: hashToken(token),
    label: row.label,
  });

  const [account] = await database
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, row.approvedByUserId))
    .limit(1);

  return NextResponse.json({
    status: "approved",
    token,
    user: { name: account?.name ?? "", email: account?.email ?? "" },
  });
}
