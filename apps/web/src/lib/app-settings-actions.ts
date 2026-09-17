"use server";

import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { apps, db } from "@cira/db";
import { slugify } from "@cira/core";
import { ForbiddenError, NotFoundError, requireAppManage } from "@/lib/authz";
import { tearDownApp } from "@/lib/app-teardown";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const detailsInput = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Give the app a name.")
    .max(60, "That name is too long."),
  description: z.string().trim().max(140, "That description is too long.").nullable(),
});

/**
 * Edit what an app says it is.
 *
 * Name and description together, because they are one thought and a person
 * correcting a generated description usually wants to adjust the name in the
 * same breath. The slug moves with the name, because an app called "Payroll"
 * living at /revenue-dashboard is its own small lie. The cost is that old
 * links break, which is why the UI says so before anyone confirms.
 *
 * An emptied description is stored as null rather than "", so it reads as
 * absent everywhere and the next deploy is free to fill it in again.
 */
export async function updateAppDetails(
  spaceSlug: string,
  appSlug: string,
  formData: FormData,
): Promise<ActionResult<{ appSlug: string }>> {
  const parsed = detailsInput.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "That name will not work.",
    };
  }

  try {
    const ctx = await requireAppManage(spaceSlug, appSlug);
    const database = db();

    const base = slugify(parsed.data.name);
    if (base === "") {
      return { ok: false, error: "Use at least a couple of letters or numbers." };
    }

    const [clash] = await database
      .select({ id: apps.id })
      .from(apps)
      .where(
        and(eq(apps.spaceId, ctx.space.id), eq(apps.slug, base), ne(apps.id, ctx.app.id)),
      )
      .limit(1);

    if (clash !== undefined) {
      return {
        ok: false,
        error: `Another app here is already called "${parsed.data.name}".`,
      };
    }

    await database
      .update(apps)
      .set({
        name: parsed.data.name,
        slug: base,
        description:
          parsed.data.description === null || parsed.data.description === ""
            ? null
            : parsed.data.description,
        updatedAt: new Date(),
      })
      .where(eq(apps.id, ctx.app.id));

    return { ok: true, data: { appSlug: base } };
  } catch (error) {
    return asError(error);
  }
}

/**
 * Remove an app from Cira and take its deployments down.
 *
 * The provider is told first. If that fails the record stays, because an app
 * Cira has forgotten but which is still serving is worse than one that is
 * merely still listed: nobody would know to go and stop it.
 */
export async function deleteApp(
  spaceSlug: string,
  appSlug: string,
  typedName: string,
): Promise<ActionResult<null>> {
  try {
    const ctx = await requireAppManage(spaceSlug, appSlug);

    // Typing the name is the confirmation. A dialog people dismiss by reflex
    // is not one.
    if (typedName.trim() !== ctx.app.name.trim()) {
      return { ok: false, error: "That name does not match, so nothing was deleted." };
    }

    const outcome = await tearDownApp(ctx.app);
    if (!outcome.ok) return { ok: false, error: outcome.error };

    return { ok: true, data: null };
  } catch (error) {
    return asError(error);
  }
}

function asError(error: unknown): ActionResult<never> {
  if (error instanceof ForbiddenError) {
    return { ok: false, error: "You do not have permission to change this app." };
  }
  if (error instanceof NotFoundError) {
    return { ok: false, error: "That app no longer exists." };
  }
  throw error;
}
