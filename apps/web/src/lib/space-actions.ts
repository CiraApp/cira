"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, spaces } from "@cira/db";
import { normalizeImage, roleAtLeast } from "@cira/core";
import { ForbiddenError, NotFoundError, requireSpaceMember } from "@/lib/authz";
import { record } from "@/lib/change-record";
import { tearDownSpace } from "@/lib/space-teardown";
import {
  expireOpenCheckouts,
  portalFor,
  subscriptionBlocksDeletion,
} from "@/lib/billing";

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
  // Asked of Stripe as it is now: one already set to end with its period is
  // on its way out, and one that expired never started, so neither stands in
  // the way.
  if (await subscriptionBlocksDeletion(ctx.space)) {
    return {
      ok: false,
      error:
        "This space still has a subscription. Cancel it under Manage billing first, " +
        "so nothing is charged after it is gone.",
    };
  }

  // A checkout left open in someone's tab could otherwise start a
  // subscription for a space that no longer exists.
  await expireOpenCheckouts(ctx.space);

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
  await record({
    spaceId: ctx.spaceId,
    kind: "space-renamed",
    actor: ctx.actor,
    actorUserId: ctx.actorUserId,
    subject: trimmed,
  });
  revalidatePath(`/${spaceSlug}`, "layout");
  return { ok: true };
}

/**
 * Give the company a logo, or take it away with an empty string.
 *
 * What arrives has already been redrawn by the browser to a small square, and
 * is checked again here, because it ends up in an `img` on every member's
 * screen and on the page an invitation opens.
 */
export async function setSpaceLogo(
  spaceSlug: string,
  image: string,
): Promise<SpaceSettingResult> {
  const removing = image.trim() === "";
  const stored = removing ? null : normalizeImage(image);
  if (!removing && stored === null) {
    return { ok: false, error: "That image could not be used. Try a PNG or JPEG." };
  }

  const ctx = await adminOf(spaceSlug);
  if (!ctx.ok) return ctx;

  await db().update(spaces).set({ image: stored }).where(eq(spaces.id, ctx.spaceId));
  await record({
    spaceId: ctx.spaceId,
    kind: "space-logo-changed",
    actor: ctx.actor,
    actorUserId: ctx.actorUserId,
    subject: ctx.name,
    detail: removing ? "removed" : null,
  });
  // The logo sits in the sidebar of every page in the space.
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
  await record({
    spaceId: ctx.spaceId,
    kind: "join-by-domain-changed",
    actor: ctx.actor,
    actorUserId: ctx.actorUserId,
    subject: ctx.domain ?? "the company domain",
    detail: on ? "on" : "off",
  });
  revalidatePath(`/${spaceSlug}/~/settings`);
  return { ok: true };
}

async function adminOf(spaceSlug: string): Promise<
  | {
      ok: true;
      spaceId: string;
      name: string;
      domain: string | null;
      actor: string;
      actorUserId: string;
    }
  | { ok: false; error: string }
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
  return {
    ok: true,
    spaceId: ctx.space.id,
    name: ctx.space.name,
    domain: ctx.space.domain,
    actor: ctx.user.name,
    actorUserId: ctx.user.id,
  };
}
