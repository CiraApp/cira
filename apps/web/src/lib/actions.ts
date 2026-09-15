"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, memberships, spaces } from "@cira/db";
import { newId, slugify } from "@cira/core";
import { requireCurrentUser } from "@/lib/identity";
import { claimableDomain } from "@/lib/email-domain";

const createSpaceInput = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Give your space a name.")
    .max(60, "That name is too long."),
});

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Create a space and make the creator its owner.
 *
 * The creator is taken from the session, never from the form, so a crafted
 * request cannot make someone else the owner.
 */
export async function createSpace(
  _previous: ActionResult<{ slug: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ slug: string }>> {
  const parsed = createSpaceInput.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "That name will not work.",
    };
  }

  const user = await requireCurrentUser();
  const database = db();

  const base = slugify(parsed.data.name);
  if (base === "") {
    return { ok: false, error: "Use at least a couple of letters or numbers." };
  }

  const slug = await findFreeSlug(base);

  const spaceId = newId("space");
  // The founder's company domain becomes the space's, so colleagues can join
  // without being invited one at a time. Only a domain they hold an address
  // at, and never a public provider.
  await database.insert(spaces).values({
    id: spaceId,
    name: parsed.data.name,
    slug,
    domain: claimableDomain(user.email),
  });

  await database.insert(memberships).values({
    id: newId("membership"),
    userId: user.id,
    spaceId,
    role: "owner",
  });

  return { ok: true, data: { slug } };
}

/** `acme`, then `acme-2`, `acme-3`, ... */
async function findFreeSlug(base: string): Promise<string> {
  const database = db();

  for (let attempt = 1; attempt <= 25; attempt += 1) {
    const candidate = attempt === 1 ? base : `${base}-${attempt}`;
    const [taken] = await database
      .select({ id: spaces.id })
      .from(spaces)
      .where(eq(spaces.slug, candidate))
      .limit(1);

    if (taken === undefined) return candidate;
  }

  return `${base}-${newId("space").slice(-6)}`;
}
