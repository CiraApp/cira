"use server";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { atomically, db, memberships, spaces } from "@cira/db";
import { RESERVED_SPACE_SLUGS, newId, slugWithSuffix, slugify } from "@cira/core";
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

/** Spaces one person may own at once without any of them having paid. */
const MAX_UNPAID_SPACES = 2;

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

  // Each new space is a fresh trial, including its free worker, which costs
  // Cira real money. Two unpaid ones at a time is room to try Cira twice -
  // for a company and a side project - not a way to run one for ever.
  const unpaid = await database
    .select({ id: spaces.id })
    .from(memberships)
    .innerJoin(spaces, eq(spaces.id, memberships.spaceId))
    .where(
      and(
        eq(memberships.userId, user.id),
        eq(memberships.role, "owner"),
        isNull(spaces.subscriptionStatus),
      ),
    );
  if (unpaid.length >= MAX_UNPAID_SPACES) {
    return {
      ok: false,
      error:
        "You already own two spaces that have never been subscribed. Subscribe one of them, or delete one, to start another.",
    };
  }

  // A name written only in a script with no Latin letters - Японский, 株式会社 -
  // has nothing to make an address from. It keeps its name, and the address is
  // a plain one that can be read aloud, rather than the company being refused.
  const base = slugify(parsed.data.name);
  const slug = await findFreeSlug(base === "" ? "space" : base);

  const spaceId = newId("space");
  // The founder's company domain becomes the space's, so colleagues can join
  // without being invited one at a time. Only a domain they hold an address
  // at, and never a public provider.
  // Together, because a space whose owner never landed is worse than no space
  // at all: nobody is a member, so nobody can open it, invite anyone to it or
  // delete it, and its slug is taken for good.
  try {
    await atomically(database, (on) => [
      on.insert(spaces).values({
        id: spaceId,
        name: parsed.data.name,
        slug,
        domain: claimableDomain(user.email),
      }),
      on.insert(memberships).values({
        id: newId("membership"),
        userId: user.id,
        spaceId,
        role: "owner",
      }),
    ]);
  } catch {
    // Two people creating the same name at the same moment: the slug was free
    // when looked for and taken when written. Said plainly, not as a stack.
    return {
      ok: false,
      error:
        "Someone took that address a moment ago. Try again and Cira will pick the next one.",
    };
  }

  return { ok: true, data: { slug } };
}

/** `acme`, then `acme-2`, `acme-3`, ... */
async function findFreeSlug(base: string): Promise<string> {
  const database = db();

  for (let attempt = 1; attempt <= 25; attempt += 1) {
    const candidate = attempt === 1 ? base : slugWithSuffix(base, String(attempt));
    if (RESERVED_SPACE_SLUGS.has(candidate)) continue;
    const [taken] = await database
      .select({ id: spaces.id })
      .from(spaces)
      .where(eq(spaces.slug, candidate))
      .limit(1);

    if (taken === undefined) return candidate;
  }

  return slugWithSuffix(base, newId("space").slice(-6));
}
