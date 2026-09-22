"use server";

import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { cliTokens, db } from "@cira/db";
import { newId } from "@cira/core";
import { newCliToken } from "@/lib/cli-auth";
import { hashToken } from "@/lib/token-hash";
import { tokenExpiry } from "@/lib/cli-session";
import { requireCurrentUser } from "@/lib/identity";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface TokenSummary {
  id: string;
  label: string;
  /** A terminal's token deploys; an assistant's only reaches MCP. */
  scope: "cli" | "assistant";
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * The tokens that let a person's assistants reach Cira.
 *
 * Every credential that can act as this person, whether issued by
 * `cira login`, by `cira mcp connect` or from the panel in the app - so the
 * list is the whole truth about who can act as you, and the revoke beside each
 * row the only place anyone has to look. A terminal's token deploys; an
 * assistant's reaches MCP only. One unused for ninety days has lapsed and is
 * not listed, because it no longer opens anything.
 */
export async function listAssistantTokens(): Promise<TokenSummary[]> {
  const user = await requireCurrentUser();

  const rows = await db()
    .select({
      id: cliTokens.id,
      label: cliTokens.label,
      scope: cliTokens.scope,
      createdAt: cliTokens.createdAt,
      lastUsedAt: cliTokens.lastUsedAt,
    })
    .from(cliTokens)
    .where(
      and(
        eq(cliTokens.userId, user.id),
        isNull(cliTokens.revokedAt),
        or(isNull(cliTokens.expiresAt), gt(cliTokens.expiresAt, new Date())),
      ),
    )
    .orderBy(desc(cliTokens.createdAt));

  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    scope: row.scope,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  }));
}

const createInput = z.object({
  label: z.string().trim().min(1, "Give it a name.").max(80),
});

/**
 * Mint a token for one of this person's own assistants.
 *
 * Returned in plaintext exactly once and stored only as a hash, the same as
 * the one `cira login` hands a terminal. A token carries the person, not the
 * space: an agent holding it reaches precisely the capabilities its owner is
 * allowed to reach, which is what stops a shared credential from flattening
 * everyone into whoever created it.
 */
export async function createAssistantToken(
  _previous: ActionResult<{ token: string; label: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ token: string; label: string }>> {
  const parsed = createInput.safeParse({ label: formData.get("label") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the name." };
  }

  const user = await requireCurrentUser();
  const token = newCliToken();

  await db()
    .insert(cliTokens)
    .values({
      id: newId("cliToken"),
      userId: user.id,
      tokenHash: hashToken(token),
      label: parsed.data.label,
      // For MCP and nothing else: a config file an assistant reads is not a
      // place for the right to deploy or remove apps.
      scope: "assistant",
      expiresAt: tokenExpiry(),
    });

  return { ok: true, data: { token, label: parsed.data.label } };
}

const revokeInput = z.object({ id: z.string().min(1) });

/**
 * Cut one assistant off.
 *
 * Scoped to the caller's own rows, so a guessed id revokes nothing: the worst
 * anyone can do with this is disconnect themselves.
 */
export async function revokeAssistantToken(
  _previous: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const parsed = revokeInput.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { ok: false, error: "That token is not yours to revoke." };

  const user = await requireCurrentUser();

  const revoked = await db()
    .update(cliTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(cliTokens.id, parsed.data.id),
        eq(cliTokens.userId, user.id),
        isNull(cliTokens.revokedAt),
      ),
    )
    .returning({ id: cliTokens.id });

  if (revoked.length === 0) {
    return { ok: false, error: "That token is not yours to revoke." };
  }

  return { ok: true, data: { id: parsed.data.id } };
}
