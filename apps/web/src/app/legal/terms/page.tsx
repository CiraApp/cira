import Link from "next/link";
import type { Metadata } from "next";
import { PLANS } from "@cira/core";
import { SiteFrame, Section } from "@/components/site/site-frame";
import { LegalDraftNotice, UPDATED } from "@/components/site/legal-notice";

export const metadata: Metadata = {
  title: "Terms",
  description: "The agreement between Cira and the companies that use it.",
};

/**
 * What Cira and a customer owe each other, in the plainest words that are
 * still accurate. Every clause describes something the product actually does;
 * where a promise would be bigger than the product, the promise is smaller.
 */
export default function TermsPage() {
  return (
    <SiteFrame>
      <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.02em] text-ink">
        Terms of service
      </h1>
      <p className="mt-2 text-[12.5px] text-ink-subtle">Last updated {UPDATED}</p>
      <LegalDraftNotice />

      <Section title="What Cira does">
        <p>
          Cira deploys and runs the software your company writes for itself, gives your
          people one place to open it, and lets their assistants use it under the same
          permissions. You decide what to deploy and who may open it.
        </p>
      </Section>

      <Section title="Your account">
        <p>
          You are responsible for who you let into your space and what they do with it.
          Roles are yours to set: admins manage apps and billing, owners can delete the
          space. Keep your credentials to yourself; tell us promptly if you think one has
          been taken.
        </p>
      </Section>

      <Section title="Your software and your data">
        <p>
          Your code and your data stay yours. You give Cira only the permission it needs
          to run them for you: to build your repository, to run it on Google Cloud, to
          store what it needs to show your company its own apps, and to read your source
          in order to describe what each app can do.
        </p>
        <p>
          You promise you have the right to deploy what you deploy, and that running it
          does not break the law or anyone else&rsquo;s rights.
        </p>
      </Section>

      <Section title="What you may not do">
        <p>
          Do not use Cira to attack anyone, to send bulk unsolicited mail, to mine
          cryptocurrency, to host malware, or to run anything whose purpose is to break
          into systems you do not own. Do not try to reach another company&rsquo;s space,
          or to get around the limits Cira sets.
        </p>
      </Section>

      <Section title="Paying">
        <p>
          The plan, its price and its allowances are on the{" "}
          <Link href="/pricing" className="underline underline-offset-4">
            pricing page
          </Link>
          : ${PLANS.team.perSeatMonthly} per person a month with {PLANS.team.minimumSeats}{" "}
          minimum, plus ${PLANS.team.workerMonthly} a month for each worker and each app
          kept warm. Subscriptions are monthly and charged in advance through Stripe;
          seats and always-on things are counted as they change, so what you are billed
          follows what you actually have.
        </p>
        <p>
          If a payment fails, your software keeps running and we will tell you. If it
          stays unpaid, the space goes back to the trial allowance - one worker - and
          nothing is deleted. Cancel any time in the billing portal; the current month is
          not refunded.
        </p>
      </Section>

      <Section title="Stopping">
        <p>
          You can export everything Cira holds about your company at any time, and delete
          your space, which takes down its apps. We can suspend or end an account that
          breaks these terms or that puts other customers at risk; where we can, we will
          tell you first and give you a chance to export.
        </p>
      </Section>

      <Section title="What we promise, and what we do not">
        <p>
          Cira is offered as it is. We do not promise it will never be down, never lose a
          log line, or suit a particular purpose. We keep it running with care, we watch
          it, and we will tell you when something breaks - but there is no uptime
          guarantee today, and you should not treat Cira as the only copy of anything.
        </p>
        <p>
          Neither of us is liable to the other for indirect or consequential losses. Our
          total liability in any twelve months is limited to what you paid Cira in those
          twelve months.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          We may change these terms as Cira changes. If a change matters to you - prices,
          what a plan includes, how your data is handled - we will tell the admins of your
          space by email before it takes effect. Carrying on using Cira after that is how
          you accept it.
        </p>
      </Section>

      <Section title="Getting in touch">
        <p>
          <a href="mailto:hello@cira.dev" className="underline underline-offset-4">
            hello@cira.dev
          </a>
          , or{" "}
          <a href="mailto:security@cira.dev" className="underline underline-offset-4">
            security@cira.dev
          </a>{" "}
          for anything about security.
        </p>
      </Section>
    </SiteFrame>
  );
}
