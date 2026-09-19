import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
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
  /** What the provider knows of their name, used only to prefill Cira's. */
  firstName: string | null;
  lastName: string | null;
  email: string;
  imageUrl: string | null;
}

async function readProviderIdentity(): Promise<ProviderIdentity | null> {
  const { userId } = await auth();
  if (userId === null) return null;

  const account = await currentUser();
  if (account === null) return null;

  // Only a VERIFIED address may be used. Space membership can be granted from
  // an email domain, so an unverified address would let anyone claim to work
  // anywhere simply by typing it in.
  const verified = account.emailAddresses.filter(
    (e) => e.verification?.status === "verified",
  );
  const primary = account.primaryEmailAddress;
  const email =
    primary !== null && primary !== undefined && verified.some((e) => e.id === primary.id)
      ? primary.emailAddress
      : verified[0]?.emailAddress;

  // An account with no verified email cannot be invited, granted access, or
  // matched to a pending invite, so it is not a usable Cira identity.
  if (email === undefined) return null;

  const name =
    [account.firstName, account.lastName].filter(Boolean).join(" ").trim() ||
    account.username ||
    email;

  return {
    externalId: userId,
    name,
    firstName: account.firstName?.trim() || null,
    lastName: account.lastName?.trim() || null,
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

  const [known] = await database
    .select()
    .from(users)
    .where(eq(users.externalId, identity.externalId))
    .limit(1);

  const existing = known ?? (await relink(identity));

  if (existing !== undefined) {
    // Keep the profile fresh, but never move the Cira id: access grants and app
    // ownership point at it.
    //
    // The name only follows the provider until the person gives Cira one. A
    // name they chose here, overwritten on their next page load by whatever
    // the sign-in provider holds, is a name they could never keep.
    const name = existing.firstName === null ? identity.name : existing.name;
    const changed =
      existing.name !== name ||
      existing.email !== identity.email ||
      existing.imageUrl !== identity.imageUrl;

    if (changed) {
      const [updated] = await database
        .update(users)
        .set({
          name,
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
      firstName: identity.firstName,
      lastName: identity.lastName,
      email: identity.email,
      imageUrl: identity.imageUrl,
    })
    // Either unique column: a concurrent first request may have created the
    // row, or re-linked one with this address, between the reads and here.
    .onConflictDoNothing()
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

/**
 * The Cira user this person already is, arriving under a new provider id.
 *
 * A sign-in provider's id for a person is only stable within one instance of
 * it. Moving Clerk from its development instance to a production one gives
 * everybody a new id, and without this every existing person would arrive as a
 * stranger - worse, as a stranger whose email is already taken, which the
 * unique index refuses. So a person whose verified address is already a Cira
 * user is that user, and the row is moved to the new id in one update.
 *
 * Only a verified address is ever used (see `readProviderIdentity`), and an
 * email is already what Cira trusts for invites and for joining a space by
 * domain, so this admits nobody that a verified address would not. It also
 * works in reverse, so pointing Cira back at the old instance is safe.
 */
async function relink(identity: ProviderIdentity): Promise<UserRow | undefined> {
  const [moved] = await db()
    .update(users)
    .set({ externalId: identity.externalId })
    .where(eq(users.email, identity.email))
    .returning();
  return moved;
}

/**
 * The signed-in user, or a redirect to sign-in.
 *
 * This is where access is actually enforced. Because every data read goes
 * through here, a new page cannot ship unprotected by being left out of a
 * route list; it is protected by the act of reading data.
 */
export async function requireCurrentUser(): Promise<User> {
  const user = await getCurrentUser();
  if (user === null) redirect("/sign-in");
  return user;
}

type UserRow = typeof users.$inferSelect;

function toUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    createdAt: row.createdAt,
  };
}
