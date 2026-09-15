import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db, users } from "@cira/db";
import { newId } from "@cira/core";
import type { User } from "@cira/core";

/**
 * The identity seam.
 *
 * This is the ONLY module that imports the auth provider. Everything else asks
 * for a Cira `User`, so swapping the provider means rewriting this file and
 * nothing else. Cira owns spaces, membership and access; the provider answers
 * only "who is this person".
 */

interface ProviderIdentity {
  externalId: string;
  name: string;
  email: string;
  imageUrl: string | null;
}

async function readProviderIdentity(): Promise<ProviderIdentity | null> {
  const { userId } = await auth();
  if (userId === null) return null;

  const account = await currentUser();
  if (account === null) return null;

  const email =
    account.primaryEmailAddress?.emailAddress ?? account.emailAddresses[0]?.emailAddress;

  // An account with no email cannot be invited, granted access, or matched to a
  // pending invite, so it is not a usable Cira identity.
  if (email === undefined) return null;

  const name =
    [account.firstName, account.lastName].filter(Boolean).join(" ").trim() ||
    account.username ||
    email;

  return {
    externalId: userId,
    name,
    email: email.toLowerCase(),
    imageUrl: account.imageUrl || null,
  };
}

/**
 * The signed-in person as a Cira user, provisioning the row on first sign-in.
 * Returns null when nobody is signed in.
 */
export async function getCurrentUser(): Promise<User | null> {
  const identity = await readProviderIdentity();
  if (identity === null) return null;

  const database = db();

  const [existing] = await database
    .select()
    .from(users)
    .where(eq(users.externalId, identity.externalId))
    .limit(1);

  if (existing !== undefined) {
    // Keep the profile fresh, but never move the Cira id: access grants and app
    // ownership point at it.
    const changed =
      existing.name !== identity.name ||
      existing.email !== identity.email ||
      existing.imageUrl !== identity.imageUrl;

    if (changed) {
      const [updated] = await database
        .update(users)
        .set({
          name: identity.name,
          email: identity.email,
          imageUrl: identity.imageUrl,
        })
        .where(eq(users.id, existing.id))
        .returning();

      if (updated !== undefined) return toUser(updated);
    }

    return toUser(existing);
  }

  const [created] = await database
    .insert(users)
    .values({
      id: newId("user"),
      externalId: identity.externalId,
      name: identity.name,
      email: identity.email,
      imageUrl: identity.imageUrl,
    })
    .onConflictDoNothing({ target: users.externalId })
    .returning();

  if (created !== undefined) return toUser(created);

  // Lost a race with a concurrent first request; the row exists now.
  const [raced] = await database
    .select()
    .from(users)
    .where(eq(users.externalId, identity.externalId))
    .limit(1);

  return raced === undefined ? null : toUser(raced);
}

/** Same as `getCurrentUser`, but throws where a signed-in user is required. */
export async function requireCurrentUser(): Promise<User> {
  const user = await getCurrentUser();
  if (user === null) throw new NotAuthenticatedError();
  return user;
}

export class NotAuthenticatedError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "NotAuthenticatedError";
  }
}

type UserRow = typeof users.$inferSelect;

function toUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: row.createdAt,
  };
}
