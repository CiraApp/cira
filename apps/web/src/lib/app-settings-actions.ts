"use server";

import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { apps, appSlugHistory, capabilities, db } from "@cira/db";
import { newId, normalizeAppImage, normalizeHomepageUrl, slugify } from "@cira/core";
import { revalidatePath } from "next/cache";
import { deploymentProvider } from "@cira/deploy";
import { ForbiddenError, NotFoundError, requireAppManage } from "@/lib/authz";
import { assertionsConfigured } from "@/lib/identity-assertion";
import { verifyAppCapabilities } from "@/lib/capability-verification";
import { planForSpace } from "@/lib/plan";
import { latestDeployment } from "@/lib/queries";
import { tearDownApp } from "@/lib/app-teardown";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Every field is optional, and absent means "leave it alone".
 *
 * Because there is more than one form. The name and description are edited
 * where they are read, at the top of the page; the homepage is edited in
 * settings. Neither shows the other's fields, and a form that cleared what it
 * never displayed would be a form that loses data the first time anybody used
 * it. Empty still means empty - that is how a description or an address is
 * deliberately taken back.
 */
const detailsInput = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Give the app a name.")
    .max(60, "That name is too long.")
    .optional(),
  description: z.string().trim().max(140, "That description is too long.").optional(),
  homepageUrl: z.string().trim().optional(),
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
  const given = (field: string): Record<string, string> => {
    const value = formData.get(field);
    return value === null ? {} : { [field]: String(value) };
  };

  const parsed = detailsInput.safeParse({
    ...given("name"),
    ...given("description"),
    ...given("homepageUrl"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "That name will not work.",
    };
  }

  // Emptied on purpose is a real edit: it is how someone takes back an address
  // that has moved, and it has to mean "Cira serves this again" rather than
  // being ignored as a blank field. Not sent at all is not an edit.
  const raw = parsed.data.homepageUrl;
  const homepageUrl = raw === undefined || raw === "" ? null : normalizeHomepageUrl(raw);
  if (raw !== undefined && raw !== "" && homepageUrl === null) {
    return {
      ok: false,
      error: "That is not a web address. Give the full one, starting with https://.",
    };
  }

  const name = parsed.data.name;

  try {
    const ctx = await requireAppManage(spaceSlug, appSlug);
    const database = db();

    // The slug moves with the name, because an app called "Payroll" living at
    // /revenue-dashboard is its own small lie. A form that did not send a name
    // leaves both alone.
    let slug = ctx.app.slug;

    // A name with nothing to make an address from - one written only in
    // another script - keeps the address it has, rather than being refused.
    if (name !== undefined && slugify(name) !== "") {
      slug = slugify(name);

      const [clash] = await database
        .select({ id: apps.id })
        .from(apps)
        .where(
          and(
            eq(apps.spaceId, ctx.space.id),
            eq(apps.slug, slug),
            ne(apps.id, ctx.app.id),
          ),
        )
        .limit(1);

      if (clash !== undefined) {
        return { ok: false, error: `Another app here is already called "${name}".` };
      }

      // An address another app used to answer on is still spoken for, because
      // it still resolves. Handing it to a second app would silently redirect
      // somebody's old link into a different app than the one they saved.
      const [taken] = await database
        .select({ appId: appSlugHistory.appId })
        .from(appSlugHistory)
        .where(
          and(
            eq(appSlugHistory.spaceId, ctx.space.id),
            eq(appSlugHistory.slug, slug),
            ne(appSlugHistory.appId, ctx.app.id),
          ),
        )
        .limit(1);

      if (taken !== undefined) {
        return {
          ok: false,
          error: `Another app here used to be called "${name}", and links to it still work.`,
        };
      }
    }

    // Keep the address it is leaving behind. Written with the rename rather
    // than after it, because an app that has moved and left no forwarding note
    // is exactly the broken link this exists to prevent.
    const moved = name !== undefined && slug !== ctx.app.slug;

    await database
      .update(apps)
      .set({
        ...(name === undefined ? {} : { name, slug }),
        ...(parsed.data.description === undefined
          ? {}
          : {
              description:
                parsed.data.description === "" ? null : parsed.data.description,
            }),
        ...(raw === undefined ? {} : { homepageUrl }),
        updatedAt: new Date(),
      })
      .where(eq(apps.id, ctx.app.id));

    if (moved) {
      await database
        .insert(appSlugHistory)
        .values({
          id: newId("appSlug"),
          appId: ctx.app.id,
          spaceId: ctx.space.id,
          slug: ctx.app.slug,
        })
        // Renamed back to something it was called before: the note is already
        // there and says the right thing.
        .onConflictDoNothing();

      // And the address it has just taken is no longer a forwarding note, or
      // opening the app would bounce through itself.
      await database
        .delete(appSlugHistory)
        .where(
          and(eq(appSlugHistory.spaceId, ctx.space.id), eq(appSlugHistory.slug, slug)),
        );
    }

    return { ok: true, data: { appSlug: slug } };
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

/**
 * Give an app a picture, or take it away.
 *
 * Sent as a data URL rather than a file, because the browser has already
 * redrawn it: whatever was chosen is scaled to a square and re-encoded before
 * it leaves the page, so this receives a few kilobytes of a known shape
 * instead of a photograph. Checked again here regardless - the browser is the
 * wrong place to enforce anything.
 *
 * An empty string is a real edit: it is how somebody takes the picture off
 * again and goes back to the letter.
 */
export async function updateAppImage(
  spaceSlug: string,
  appSlug: string,
  image: string,
): Promise<ActionResult<null>> {
  const stored = image.trim() === "" ? null : normalizeAppImage(image);

  if (image.trim() !== "" && stored === null) {
    return { ok: false, error: "That image could not be used. Try a PNG or JPEG." };
  }

  try {
    const ctx = await requireAppManage(spaceSlug, appSlug);

    await db()
      .update(apps)
      .set({ image: stored, updatedAt: new Date() })
      .where(eq(apps.id, ctx.app.id));

    return { ok: true, data: null };
  } catch (error) {
    return asError(error);
  }
}

/**
 * Keep one instance of an app running, so the first request after a quiet
 * spell does not wait for a container to start.
 *
 * A paid plan's option, because Cloud Run charges for that instance every
 * hour it exists - about what a worker costs - and it is billed as its own
 * line rather than buried in the seat price.
 */
export async function setKeepWarm(
  spaceSlug: string,
  appSlug: string,
  warm: boolean,
): Promise<ActionResult<{ warm: boolean }>> {
  let ctx;
  try {
    ctx = await requireAppManage(spaceSlug, appSlug);
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) {
      return { ok: false, error: "No such app, or you do not manage it." };
    }
    throw error;
  }

  const plan = await planForSpace(ctx.space.id);
  if (warm && plan.id !== "team") {
    return {
      ok: false,
      error: "Keeping an app warm costs money every hour, so it needs a paid plan.",
    };
  }

  const deployment = await latestDeployment(ctx.app.id);
  if (
    deployment === null ||
    deployment.provider !== "cloudrun" ||
    !deployment.servesWeb
  ) {
    return {
      ok: false,
      error: "This app has no web address to keep warm.",
    };
  }

  try {
    await deploymentProvider().setMinInstances(
      deployment.providerDeploymentId,
      warm ? 1 : 0,
    );
  } catch {
    return { ok: false, error: "Google would not make that change right now." };
  }

  await db()
    .update(apps)
    .set({ minInstances: warm ? 1 : 0, updatedAt: new Date() })
    .where(eq(apps.id, ctx.app.id));

  revalidatePath(`/${spaceSlug}/${appSlug}`);
  return { ok: true, data: { warm } };
}

/**
 * Tell this app who is calling, or stop telling it.
 *
 * Off by default and per app, because an app that is not expecting a claim
 * about a person should never start receiving one. Turning it on clears every
 * refusal this app collected while Cira was calling as nobody: they were
 * answers to a different question, and leaving them would hide the very
 * capabilities the setting exists to unlock. They are asked again, as the
 * person who turned it on.
 */
export async function setTellsWhoIsCalling(
  spaceSlug: string,
  appSlug: string,
  tell: boolean,
): Promise<ActionResult<{ tell: boolean }>> {
  let ctx;
  try {
    ctx = await requireAppManage(spaceSlug, appSlug);
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) {
      return { ok: false, error: "No such app, or you do not manage it." };
    }
    throw error;
  }

  if (tell && !assertionsConfigured()) {
    return {
      ok: false,
      error: "This Cira has no signing key yet, so it cannot vouch for anyone.",
    };
  }

  const database = db();
  await database
    .update(apps)
    .set({ tellsWhoIsCalling: tell, updatedAt: new Date() })
    .where(eq(apps.id, ctx.app.id));

  if (tell) {
    await database
      .update(capabilities)
      .set({
        reach: "pending",
        answeredBy: null,
        verifiedAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(capabilities.appId, ctx.app.id), eq(capabilities.reach, "refused")));
    await verifyAppCapabilities(ctx.app.id, {
      user: ctx.user,
      spaceSlug,
    }).catch(() => undefined);
  }

  revalidatePath(`/${spaceSlug}/${appSlug}`);
  return { ok: true, data: { tell } };
}
