"use server";

import { ForbiddenError, NotFoundError, requireSpaceMember } from "@/lib/authz";
import { checkoutFor, portalFor, type BillingOutcome } from "@/lib/billing";
import { roleAtLeast } from "@cira/core";

/**
 * Starting to pay, and changing how. Both hand back a URL at Stripe rather
 * than doing anything themselves: Cira never sees a card.
 *
 * Owners and admins only - the same people the usage page is for, since they
 * are the ones an invoice reaches.
 */
async function billingRights(spaceSlug: string) {
  const ctx = await requireSpaceMember(spaceSlug);
  if (!roleAtLeast(ctx.role, "admin")) throw new ForbiddenError("manage billing");
  return ctx;
}

export async function startCheckout(spaceSlug: string): Promise<BillingOutcome> {
  try {
    const ctx = await billingRights(spaceSlug);
    return await checkoutFor(ctx.space);
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) {
      return { ok: false, error: "No such space, or you do not manage its billing." };
    }
    throw error;
  }
}

export async function openBilling(spaceSlug: string): Promise<BillingOutcome> {
  try {
    const ctx = await billingRights(spaceSlug);
    return await portalFor(ctx.space);
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) {
      return { ok: false, error: "No such space, or you do not manage its billing." };
    }
    throw error;
  }
}
