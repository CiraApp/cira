"use server";

import { redirect } from "next/navigation";
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
