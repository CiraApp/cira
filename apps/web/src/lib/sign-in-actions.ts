"use server";

import { revalidatePath } from "next/cache";
import { roleAtLeast } from "@cira/core";
import { NotFoundError, requireSpaceMember } from "@/lib/authz";
import { finishSso, removeSso, startSso, type SsoDetails } from "@/lib/sso";
import { issueScimToken, revokeScim } from "@/lib/scim";
import { record } from "@/lib/change-record";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * How a company's people get in: through its own identity provider, and kept
 * in step with its directory. Admins only - it decides who is in the company.
 */

async function admin(spaceSlug: string) {
  try {
    const ctx = await requireSpaceMember(spaceSlug);
    return roleAtLeast(ctx.role, "admin") ? ctx : null;
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

const REFUSED = {
  ok: false as const,
  error: "Only an admin of this space can change how people sign in.",
};

export async function beginSso(
  spaceSlug: string,
  domain: string,
): Promise<ActionResult<SsoDetails>> {
  const ctx = await admin(spaceSlug);
  if (ctx === null) return REFUSED;
  const outcome = await startSso({
    spaceId: ctx.space.id,
    spaceName: ctx.space.name,
    userId: ctx.user.id,
    userEmail: ctx.user.email,
    domain,
  });
  if (outcome.ok) {
    await record({
      spaceId: ctx.space.id,
      kind: "sso-begun",
      actor: ctx.user.name,
      actorUserId: ctx.user.id,
      subject: outcome.details.domain,
    });
  }
  revalidatePath(`/${spaceSlug}/~/settings`);
  return outcome.ok ? { ok: true, data: outcome.details } : outcome;
}

export async function completeSso(
  spaceSlug: string,
  metadataUrl: string,
): Promise<ActionResult<SsoDetails>> {
  const ctx = await admin(spaceSlug);
  if (ctx === null) return REFUSED;
  const outcome = await finishSso({ spaceId: ctx.space.id, idpMetadataUrl: metadataUrl });
  if (outcome.ok) {
    await record({
      spaceId: ctx.space.id,
      kind: "sso-enabled",
      actor: ctx.user.name,
      actorUserId: ctx.user.id,
      subject: outcome.details.domain,
    });
  }
  revalidatePath(`/${spaceSlug}/~/settings`);
  return outcome.ok ? { ok: true, data: outcome.details } : outcome;
}

export async function endSso(spaceSlug: string): Promise<ActionResult<null>> {
  const ctx = await admin(spaceSlug);
  if (ctx === null) return REFUSED;
  const outcome = await removeSso(ctx.space.id);
  if (outcome.ok) {
    await record({
      spaceId: ctx.space.id,
      kind: "sso-stopped",
      actor: ctx.user.name,
      actorUserId: ctx.user.id,
      subject: ctx.space.name,
    });
  }
  revalidatePath(`/${spaceSlug}/~/settings`);
  return outcome.ok ? { ok: true, data: null } : outcome;
}

/** A new SCIM token, shown once; any earlier one stops working. */
export async function makeScimToken(
  spaceSlug: string,
): Promise<ActionResult<{ token: string }>> {
  const ctx = await admin(spaceSlug);
  if (ctx === null) return REFUSED;
  const token = await issueScimToken(ctx.space.id, ctx.user.id);
  // The token itself is never written down here, any more than it is anywhere
  // else: only that one was made, by whom, and when.
  await record({
    spaceId: ctx.space.id,
    kind: "scim-token-made",
    actor: ctx.user.name,
    actorUserId: ctx.user.id,
    subject: ctx.space.name,
  });
  revalidatePath(`/${spaceSlug}/~/settings`);
  return { ok: true, data: { token } };
}

export async function stopScim(spaceSlug: string): Promise<ActionResult<null>> {
  const ctx = await admin(spaceSlug);
  if (ctx === null) return REFUSED;
  await revokeScim(ctx.space.id);
  await record({
    spaceId: ctx.space.id,
    kind: "scim-stopped",
    actor: ctx.user.name,
    actorUserId: ctx.user.id,
    subject: ctx.space.name,
  });
  revalidatePath(`/${spaceSlug}/~/settings`);
  return { ok: true, data: null };
}
