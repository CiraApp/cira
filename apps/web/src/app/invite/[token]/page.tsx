import { SignInButton } from "@clerk/nextjs";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { db, invites, spaces } from "@cira/db";
import { isInviteToken } from "@cira/core";
import { getCurrentUser } from "@/lib/identity";
import { checkInvite } from "@/lib/invite-rules";
import { AcceptInvite } from "@/components/accept-invite";

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

  if (!isInviteToken(token)) return <Shell title="This invite link is not valid." />;

  const [row] = await db()
    .select({ invite: invites, space: spaces })
    .from(invites)
    .innerJoin(spaces, eq(invites.spaceId, spaces.id))
    .where(eq(invites.token, token))
    .limit(1);

  if (row === undefined) return <Shell title="This invite link is not valid." />;

  const user = await getCurrentUser();

  if (user === null) {
    return (
      <Shell title={`Join ${row.space.name} on Cira`} subtitle="Sign in to accept.">
        <SignInButton mode="modal">
          <button
            type="button"
            className="rounded-xl bg-accent px-5 py-2.5 text-[15px] font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Sign in to continue
          </button>
        </SignInButton>
      </Shell>
    );
  }

  const verdict = checkInvite({
    invite: row.invite,
    viewerEmail: user.email,
    now: new Date(),
  });

  if (!verdict.ok) {
    return (
      <Shell title={`Join ${row.space.name} on Cira`} subtitle={verdict.message}>
        <Link
          href="/"
          className="text-[14px] text-ink-muted underline-offset-4 transition-colors hover:text-ink hover:underline"
        >
          Go to Cira
        </Link>
      </Shell>
    );
  }

  return (
    <Shell
      title={`Join ${row.space.name} on Cira`}
      subtitle={`You were invited as ${row.invite.role === "admin" ? "an admin" : "a member"}.`}
    >
      <AcceptInvite token={token} spaceName={row.space.name} />
    </Shell>
  );
}

function Shell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <main className="animate-fade-in mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-16">
      <div
        aria-hidden="true"
        className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl bg-accent"
      >
        <svg viewBox="0 0 32 32" className="h-[26px] w-[26px]">
          <path
            d="M21.5 11.4a7 7 0 1 0 0 9.2"
            fill="none"
            stroke="#fff"
            strokeWidth="3.4"
            strokeLinecap="round"
          />
        </svg>
      </div>

      <h1 className="text-[26px] leading-tight font-semibold tracking-tight text-ink">
        {title}
      </h1>

      {subtitle !== undefined ? (
        <p className="mt-2.5 text-[15px] leading-relaxed text-ink-muted">{subtitle}</p>
      ) : null}

      {children !== undefined ? <div className="mt-7">{children}</div> : null}
    </main>
  );
}
