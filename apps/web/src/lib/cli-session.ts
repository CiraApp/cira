import "server-only";

import { eq } from "drizzle-orm";
import { cliTokens, db, users } from "@cira/db";
import type { User } from "@cira/core";
import { hashToken } from "@/lib/token-hash";

/**
 * The person behind a CLI request, or null.
 *
 * The token arrives as a bearer credential and is looked up by hash, so the
 * plaintext never touches the database. A revoked token resolves to nobody.
 */
export async function userFromRequest(request: Request): Promise<User | null> {
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

  // Best effort: a failed touch must not fail the request it was recording.
  void database
    .update(cliTokens)
    .set({ lastUsedAt: new Date() })
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
