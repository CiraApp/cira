"use server";

import { eq } from "drizzle-orm";
import { db, users } from "@cira/db";
import { requireCurrentUser } from "@/lib/identity";
import { parsePersonName } from "@/lib/person-name";

export type ProfileResult =
  { ok: true; firstName: string } | { ok: false; error: string };

/**
 * Change the name Cira calls you by.
 *
 * Only ever your own: the person is read from the session, never from the
 * form. Written to Cira's record rather than the sign-in provider's, which is
 * what lets it stick - signing in no longer overwrites a name once you have
 * given one. `name` moves with it, because it is what every other page shows.
 */
export async function updateProfile(
  _previous: ProfileResult | null,
  form: FormData,
): Promise<ProfileResult> {
  const user = await requireCurrentUser();
  const parsed = parsePersonName(form.get("firstName"), form.get("lastName"));
  if (!parsed.ok) return parsed;

  await db()
    .update(users)
    .set({ firstName: parsed.firstName, lastName: parsed.lastName, name: parsed.name })
    .where(eq(users.id, user.id));

  return { ok: true, firstName: parsed.firstName };
}
