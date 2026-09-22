"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError, NotFoundError, requireAppManage } from "@/lib/authz";
import { addDomain, removeDomain, refreshDomains } from "@/lib/app-domains";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Giving an app a name of the company's own, and taking it away. Managing the
 * app is what it takes: the name decides where everyone who opens it goes.
 */

async function managed(spaceSlug: string, appSlug: string) {
  try {
    return await requireAppManage(spaceSlug, appSlug);
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) return null;
    throw error;
  }
}

export async function addAppDomain(
  spaceSlug: string,
  appSlug: string,
  hostname: string,
): Promise<ActionResult<{ hostname: string }>> {
  const ctx = await managed(spaceSlug, appSlug);
  if (ctx === null) return { ok: false, error: "No such app, or you do not manage it." };
  const added = await addDomain({
    appId: ctx.app.id,
    userId: ctx.user.id,
    input: hostname,
  });
  if (!added.ok) return added;
  revalidatePath(`/${spaceSlug}/${appSlug}`);
  return { ok: true, data: { hostname: added.domain.hostname } };
}

export async function removeAppDomain(
  spaceSlug: string,
  appSlug: string,
  hostname: string,
): Promise<ActionResult<null>> {
  const ctx = await managed(spaceSlug, appSlug);
  if (ctx === null) return { ok: false, error: "No such app, or you do not manage it." };
  const removed = await removeDomain(ctx.app.id, hostname);
  if (!removed.ok) return removed;
  revalidatePath(`/${spaceSlug}/${appSlug}`);
  return { ok: true, data: null };
}

/** Ask Cloudflare now, for someone who has just changed their DNS. */
export async function checkAppDomains(
  spaceSlug: string,
  appSlug: string,
): Promise<ActionResult<null>> {
  const ctx = await managed(spaceSlug, appSlug);
  if (ctx === null) return { ok: false, error: "No such app, or you do not manage it." };
  await refreshDomains(new Date(), ctx.app.id);
  revalidatePath(`/${spaceSlug}/${appSlug}`);
  return { ok: true, data: null };
}
