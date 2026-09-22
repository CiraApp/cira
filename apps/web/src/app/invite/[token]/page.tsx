import { SignInButton } from "@clerk/nextjs";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { db, invites, spaces } from "@cira/db";
import { isInviteToken } from "@cira/core";
import { getCurrentUser } from "@/lib/identity";
import { checkInvite } from "@/lib/invite-rules";
import { AcceptInvite } from "@/components/accept-invite";
import { SwitchAccount } from "@/components/switch-account";
import { EntryFrame } from "@/components/entry-frame";
import { hashToken } from "@/lib/token-hash";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Invitation" };

/**
 * The one screen reachable while signed out, because the person receiving an
 * invite may have no account yet. It never reveals more than the space name,
 * so a guessed token leaks nothing useful.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!isInviteToken(token)) return <EntryFrame title="This invite link is not valid." />;

  const [row] = await db()
    .select({ invite: invites, space: spaces })
    .from(invites)
    .innerJoin(spaces, eq(invites.spaceId, spaces.id))
    .where(eq(invites.tokenHash, hashToken(token)))
    .limit(1);

  if (row === undefined) return <EntryFrame title="This invite link is not valid." />;

  const user = await getCurrentUser();

  if (user === null) {
    return (
      <EntryFrame title={`Join ${row.space.name} on Cira`} subtitle="Sign in to accept.">
        <SignInButton mode="modal">
          <button type="button" className="btn btn-primary btn-lg">
            Sign in to continue
          </button>
        </SignInButton>
      </EntryFrame>
    );
  }

  const verdict = checkInvite({
    invite: row.invite,
    viewerEmail: user.email,
    now: new Date(),
  });

  if (!verdict.ok) {
    // Signed in as somebody else - often the same person's other address.
    // Saying which account this is, and offering the way out, is the whole
    // difference between a dead end and one more click.
    const wrongAccount = verdict.code === "wrong-account";
    return (
      <EntryFrame
        title={`Join ${row.space.name} on Cira`}
        subtitle={
          wrongAccount
            ? `${verdict.message} You are signed in as ${user.email}.`
            : verdict.message
        }
        footer={
          wrongAccount ? (
            <Link
              href="/"
              className="text-[13px] text-ink-subtle underline-offset-4 transition-colors hover:text-ink hover:underline"
            >
              Stay signed in as {user.email}
            </Link>
          ) : undefined
        }
      >
        {wrongAccount ? (
          <SwitchAccount backTo={`/invite/${token}`} email={row.invite.email} />
        ) : (
          <Link
            href="/"
            className="text-[14px] text-ink-muted underline-offset-4 transition-colors hover:text-ink hover:underline"
          >
            Go to Cira
          </Link>
        )}
      </EntryFrame>
    );
  }

  return (
    <EntryFrame
      title={`Join ${row.space.name} on Cira`}
      subtitle={`You were invited as ${row.invite.role === "admin" ? "an admin" : "a member"}.`}
    >
      <AcceptInvite token={token} spaceName={row.space.name} />
    </EntryFrame>
  );
}
