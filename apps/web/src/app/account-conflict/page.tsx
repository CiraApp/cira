import type { Metadata } from "next";
import { EntryFrame } from "@/components/entry-frame";
import { SignOutButton } from "@/components/sign-out-button";

export const metadata: Metadata = { title: "This address is taken · Cira" };

/**
 * Where someone lands when their verified address already belongs to another
 * Cira account that is still in use, or that belongs to a company.
 *
 * Cira used to merge them into that account, which is how a recycled address
 * - the new hire given a leaver's mailbox - would have become the leaver,
 * with every membership and app they had. It now says so and stops, and names
 * who can fix it. Deliberately reads nothing about either account: the page
 * must not tell a stranger whose address this was.
 */
export default function AccountConflictPage() {
  return (
    <EntryFrame
      title="This address is already in use"
      subtitle="Another Cira account has this email address, so you have not been signed in to it."
      footer={<SignOutButton label="Sign out and use another address" />}
    >
      <p className="text-[13.5px] leading-relaxed text-ink-muted">
        If the address used to belong to someone else at your company, an admin there can
        remove that person from the company&rsquo;s space and invite you. If it is yours
        and you signed up again, write to hello@cira.dev from this address and we will
        sort it out.
      </p>
    </EntryFrame>
  );
}
