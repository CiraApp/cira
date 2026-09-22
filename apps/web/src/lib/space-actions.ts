"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, spaces } from "@cira/db";
import { roleAtLeast } from "@cira/core";
import { ForbiddenError, NotFoundError, requireSpaceMember } from "@/lib/authz";
import { tearDownSpace } from "@/lib/space-teardown";
import { billingConfigured, portalFor } from "@/lib/billing";

/**
 * Deleting a company's space: the owner's decision, nobody else's, and only
 * with the name typed back.
 *
 * A space that is still paying is not deleted, because the invoice would
 * outlive the thing it is for. Cancelling is one click away in Stripe's own
 * portal and is a decision about money, which is theirs to make there.
 */
export type DeleteSpaceResult = { ok: false; error: string };

export async function deleteSpace(
  spaceSlug: string,
  confirmation: string,
): Promise<DeleteSpaceResult> {
  let ctx;
  try {
    ctx = await requireSpaceMember(spaceSlug);
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) {
      return { ok: false, error: "No such space." };
    }
    throw error;
  }

  if (!roleAtLeast(ctx.role, "owner")) {
    return { ok: false, error: "Only an owner can delete a space." };
  }
  if (confirmation.trim() !== ctx.space.name.trim()) {
    return { ok: false, error: "That is not the space's name." };
  }
  if (
    billingConfigured() &&
    ctx.space.stripeSubscriptionId !== null &&
    ctx.space.subscriptionStatus !== "canceled"
  ) {
    return {
      ok: false,
      error:
        "This space still has a subscription. Cancel it under Manage billing first, " +
        "so nothing is charged after it is gone.",
    };
  }

  const result = await tearDownSpace(ctx.space);
  if (!result.ok) return result;

  redirect("/");
}

/** Where to cancel a subscription, for the message above to point at. */
export async function billingPortalUrl(spaceSlug: string): Promise<string | null> {
  try {
    const ctx = await requireSpaceMember(spaceSlug);
    if (!roleAtLeast(ctx.role, "owner")) return null;
    const outcome = await portalFor(ctx.space);
    return outcome.ok ? outcome.url : null;
  } catch {
    return null;
  }
}

export type SpaceSettingResult = { ok: true } | { ok: false; error: string };

/**
 * Give the space another name. Its address stays: every link anyone saved,
 * every CLI folder linked to it and every assistant pointed at it uses the
 * slug, and none of them should break because the company rebranded.
 */
export async function renameSpace(
  spaceSlug: string,
  name: string,
): Promise<SpaceSettingResult> {
  const ctx = await adminOf(spaceSlug);
  if (!ctx.ok) return ctx;

  const trimmed = name.trim();
  if (trimmed.length < 2) return { ok: false, error: "Give the space a name." };
  if (trimmed.length > 60) return { ok: false, error: "That name is too long." };

  await db().update(spaces).set({ name: trimmed }).where(eq(spaces.id, ctx.spaceId));
  revalidatePath(`/${spaceSlug}`, "layout");
  return { ok: true };
}

/**
 * Whether anyone with a verified address at the space's domain may join
 * without being invited. Off unless an admin says otherwise: it is a door
 * opened to everyone who has, or will ever have, one of those addresses.
 */
export async function setJoinByDomain(
  spaceSlug: string,
  on: boolean,
): Promise<SpaceSettingResult> {
  const ctx = await adminOf(spaceSlug);
  if (!ctx.ok) return ctx;
  if (on && ctx.domain === null) {
    return {
      ok: false,
      error: "This space has no company domain, so there is nobody to let in by address.",
    };
  }

  await db().update(spaces).set({ joinByDomain: on }).where(eq(spaces.id, ctx.spaceId));
  revalidatePath(`/${spaceSlug}/~/settings`);
  return { ok: true };
}

async function adminOf(
  spaceSlug: string,
): Promise<
  { ok: true; spaceId: string; domain: string | null } | { ok: false; error: string }
> {
  let ctx;
  try {
    ctx = await requireSpaceMember(spaceSlug);
  } catch (error) {
    if (error instanceof NotFoundError) return { ok: false, error: "No such space." };
    throw error;
  }
  if (!roleAtLeast(ctx.role, "admin")) {
    return { ok: false, error: "Only admins and owners can change this." };
  }
  return { ok: true, spaceId: ctx.space.id, domain: ctx.space.domain };
}
