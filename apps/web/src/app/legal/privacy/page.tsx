import Link from "next/link";
import type { Metadata } from "next";
import { SiteFrame, Section } from "@/components/site/site-frame";
import { LegalDraftNotice, UPDATED } from "@/components/site/legal-notice";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Cira holds about you and your company, and what it does not.",
};

/**
 * What Cira holds, why, and for how long. The short version is that Cira
 * holds metadata about software rather than the software's data, and the page
 * is short because that is true.
 */
export default function PrivacyPage() {
  return (
    <SiteFrame>
      <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.02em] text-ink">
        Privacy
      </h1>
      <p className="mt-2 text-[12.5px] text-ink-subtle">Last updated {UPDATED}</p>
      <LegalDraftNotice />

      <Section title="What Cira holds">
        <p>
          About people: name, email address, and which company and role they have. Sign-in
          itself is handled by Clerk; Cira keeps no password.
        </p>
        <p>
          About your software: each app&rsquo;s name and address, what it was built from,
          which operations it offers, its deploy history, its workers and timetables, and
          the names of its environment variables.
        </p>
        <p>
          About use: who ran which operation, from where, and how it ended; which app
          someone opened; what a question to Ask Cira cost. Never what an operation was
          called with, what it returned, or what anybody asked.
        </p>
      </Section>

      <Section title="What Cira does not hold">
        <p>
          The values of your environment variables. They pass through Cira on their way to
          Google and are never written to its database or its logs - only a fingerprint,
          so a page can say a value changed.
        </p>
        <p>
          Your apps&rsquo; own data. Cira has no database inside your app and never copies
          one out. Your apps&rsquo; logs stay in Google Cloud and are read on demand by
          people who manage them.
        </p>
        <p>
          Ask Cira conversations, which live in the browser tab that holds them. No
          session replay, ever: Cira&rsquo;s screens show companies&rsquo; own data.
        </p>
      </Section>

      <Section title="Who else sees it">
        <p>
          The companies listed under{" "}
          <Link href="/legal/subprocessors" className="underline underline-offset-4">
            subprocessors
          </Link>
          , each for one job. Cira does not sell anything about you, and does not use your
          data to train models. Source files are sent to Anthropic at deploy time to
          describe what an app can do, and questions to Ask Cira are answered there;
          neither is used for training under Anthropic&rsquo;s commercial terms.
        </p>
      </Section>

      <Section title="How long">
        <p>
          While your space exists. Deleting a space deletes its apps, people, history and
          records; it cannot be undone. Backups roll off on their own within weeks.
        </p>
      </Section>

      <Section title="Your choices">
        <p>
          Any admin can export everything Cira holds about the company as one file, from
          Settings. An owner can delete the space from the same page. If you want a
          person&rsquo;s own record removed, or have any other request about personal
          data, write to{" "}
          <a href="mailto:privacy@cira.dev" className="underline underline-offset-4">
            privacy@cira.dev
          </a>
          .
        </p>
      </Section>

      <Section title="Where it lives">
        <p>
          The United States. If you are in the UK or the EU and need a data processing
          agreement or the standard contractual clauses, write to{" "}
          <a href="mailto:privacy@cira.dev" className="underline underline-offset-4">
            privacy@cira.dev
          </a>{" "}
          and we will send one.
        </p>
      </Section>
    </SiteFrame>
  );
}
