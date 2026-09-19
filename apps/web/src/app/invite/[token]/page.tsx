import { SignInButton } from "@clerk/nextjs";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { db, invites, spaces } from "@cira/db";
import { isInviteToken } from "@cira/core";
import { getCurrentUser } from "@/lib/identity";
import { checkInvite } from "@/lib/invite-rules";
import { AcceptInvite } from "@/components/accept-invite";
import { EntryFrame } from "@/components/entry-frame";
import { hashToken } from "@/lib/token-hash";

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
    return (
      <EntryFrame title={`Join ${row.space.name} on Cira`} subtitle={verdict.message}>
        <Link
          href="/"
          className="text-[14px] text-ink-muted underline-offset-4 transition-colors hover:text-ink hover:underline"
        >
          Go to Cira
        </Link>
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
