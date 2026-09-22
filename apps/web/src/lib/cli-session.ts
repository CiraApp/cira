import "server-only";

import { eq } from "drizzle-orm";
import { cliTokens, db, users } from "@cira/db";
import type { User } from "@cira/core";
import { hashToken } from "@/lib/token-hash";

/** How long a token lives without being used. Every use starts it again. */
export const TOKEN_IDLE_DAYS = 90;

/** When a token used now should next lapse. */
export function tokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + TOKEN_IDLE_DAYS * 86_400_000);
}

/**
 * The person behind a CLI or MCP request, or null.
 *
 * The token arrives as a bearer credential and is looked up by hash, so the
 * plaintext never touches the database. A revoked token resolves to nobody,
 * and so does one that has gone ninety days unused.
 *
 * `for` says what the request is. Every route that deploys, removes or reads
 * the CLI's own records asks for `cli`, and an assistant's token - which only
 * reaches MCP - is nobody there.
 */
export async function userFromRequest(
  request: Request,
  purpose: "cli" | "assistant" = "cli",
): Promise<User | null> {
  const header = request.headers.get("authorization");
  if (header === null) return null;

  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || token === undefined || token === "") {
    return null;
  }

  const database = db();

  const [row] = await database
    .select({ token: cliTokens, user: users })
    .from(cliTokens)
    .innerJoin(users, eq(users.id, cliTokens.userId))
    .where(eq(cliTokens.tokenHash, hashToken(token)))
    .limit(1);

  if (row === undefined || row.token.revokedAt !== null) return null;

  const now = new Date();
  if (row.token.expiresAt !== null && row.token.expiresAt.getTime() <= now.getTime()) {
    return null;
  }
  if (purpose === "cli" && row.token.scope !== "cli") return null;

  // Best effort: a failed touch must not fail the request it was recording.
  void database
    .update(cliTokens)
    .set({ lastUsedAt: now, expiresAt: tokenExpiry(now) })
    .where(eq(cliTokens.id, row.token.id))
    .catch(() => undefined);

  return {
    id: row.user.id,
    name: row.user.name,
    firstName: row.user.firstName,
    lastName: row.user.lastName,
    email: row.user.email,
    createdAt: row.user.createdAt,
  };
}
