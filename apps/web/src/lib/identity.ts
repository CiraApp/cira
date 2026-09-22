import "server-only";

import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { cliTokens, db, memberships, users } from "@cira/db";
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

  let existing = known;
  if (existing === undefined) {
    try {
      existing = await relink(identity);
    } catch (error) {
      // Said on a page of its own: an error thrown from here would reach the
      // person as "something went wrong", with no way to learn what or why.
      if (error instanceof AddressTakenError) redirect("/account-conflict");
      throw error;
    }
  }

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
      let updated: UserRow | undefined;
      try {
        [updated] = await database
          .update(users)
          .set({
            name,
            email: identity.email,
            imageUrl: identity.imageUrl,
          })
          .where(eq(users.id, existing.id))
          .returning();
      } catch {
        // The new address is still held by another Cira row - a person who
        // left, most likely. Keeping the address this person had is better
        // than locking them out of every page until someone notices.
        [updated] = await database
          .update(users)
          .set({ name, imageUrl: identity.imageUrl })
          .where(eq(users.id, existing.id))
          .returning();
      }

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
 * When Cira's production sign-in went live. People who signed in before it did
 * so on Clerk's development instance, whose ids production does not know.
 */
const PRODUCTION_SIGN_IN_SINCE = new Date("2026-09-19T00:00:00Z");

/**
 * The Cira user this person already is, arriving under a new provider id.
 *
 * A sign-in provider's id for a person is only stable within one instance of
 * it. Moving Clerk from its development instance to production gave everybody
 * a new id, and without this every existing person would have arrived as a
 * stranger whose email was already taken. So a person whose verified address
 * is already a Cira user can become that user.
 *
 * But an address is not a person forever. When alice@acme.com leaves, the
 * company may give the address to someone else, and that someone signing up
 * must not become Alice - with every membership, role and app she had, in
 * every company that invited her. So the move happens only when it is plainly
 * the same person under a new id:
 *
 * - the id the row holds does not exist in this sign-in instance any more,
 *   so no living account is being displaced; and
 * - the row is from before production sign-in, which is exactly the move this
 *   is for, or it belongs to no space at all, so there is nothing to inherit.
 *
 * Anything else is refused, and the person is told who can sort it out.
 */
async function relink(identity: ProviderIdentity): Promise<UserRow | undefined> {
  const database = db();
  const [holder] = await database
    .select()
    .from(users)
    .where(eq(users.email, identity.email))
    .limit(1);
  if (holder === undefined) return undefined;

  if (await accountStillExists(holder.externalId)) {
    throw new AddressTakenError();
  }

  const fromBeforeProduction = holder.createdAt < PRODUCTION_SIGN_IN_SINCE;
  if (!fromBeforeProduction) {
    const [anyMembership] = await database
      .select({ id: memberships.id })
      .from(memberships)
      .where(eq(memberships.userId, holder.id))
      .limit(1);
    if (anyMembership !== undefined) throw new AddressTakenError();
  }

  // Whatever the old sign-in left running stops: a terminal still holding its
  // token must not go on acting as whoever holds this row from now on.
  await database
    .update(cliTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(cliTokens.userId, holder.id), isNull(cliTokens.revokedAt)));

  const [moved] = await database
    .update(users)
    .set({ externalId: identity.externalId })
    .where(eq(users.id, holder.id))
    .returning();
  return moved;
}

/** Whether the sign-in provider still has an account with this id. */
async function accountStillExists(externalId: string): Promise<boolean> {
  try {
    const client = await clerkClient();
    await client.users.getUser(externalId);
    return true;
  } catch (error) {
    // Only a clear "no such user" counts as gone. Anything else - the provider
    // briefly unreachable - is not evidence, and refusing is the safe answer.
    const status = (error as { status?: number }).status;
    return status !== 404;
  }
}

/**
 * A verified address that already belongs to a different Cira account. Shown
 * to the person on the sign-in error page rather than silently merging them.
 */
export class AddressTakenError extends Error {
  constructor() {
    super(
      "This email address already belongs to another Cira account. If it used to be someone else's, ask an admin of your company to remove that person and invite you.",
    );
    this.name = "AddressTakenError";
  }
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
