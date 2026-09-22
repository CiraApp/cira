import { NextResponse } from "next/server";
import { z } from "zod";
import { cliTokens, db } from "@cira/db";
import { newId } from "@cira/core";
import { newCliToken } from "@/lib/cli-auth";
import { tokenExpiry, userFromRequest } from "@/lib/cli-session";
import { hashToken } from "@/lib/token-hash";

/**
 * A token for the assistants on this machine, asked for by `cira mcp connect`.
 *
 * The CLI's own token deploys and removes apps. It used to be written into
 * every assistant's config as well, so anything that could read that file -
 * or any assistant told to - could take down every app its owner managed.
 * Assistants get their own token instead, which reaches MCP and nothing else,
 * and can be revoked from Cira without logging the terminal out.
 */
const body = z.object({ machine: z.string().trim().min(1).max(60) });

export async function POST(request: Request) {
  const user = await userFromRequest(request);
  if (user === null) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const token = newCliToken();
  const label = `Assistants on ${parsed.data.machine}`;
  await db()
    .insert(cliTokens)
    .values({
      id: newId("cliToken"),
      userId: user.id,
      tokenHash: hashToken(token),
      label,
      scope: "assistant",
      expiresAt: tokenExpiry(),
    });

  return NextResponse.json({ token, label });
}
