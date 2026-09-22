import Link from "next/link";
import { redirect } from "next/navigation";
import { PLANS } from "@cira/core";
import { getCurrentUser } from "@/lib/identity";
import { listMySpaces } from "@/lib/authz";
import { SiteFrame } from "@/components/site/site-frame";

/**
 * The front door.
 *
 * Signed in, there is nothing to say that a space does not say better, so
 * this is only ever a redirect: to their company, or to making one. Signed
 * out, it is the one page that has to explain what Cira is to somebody who
 * has never heard of it - in the product's own words rather than a campaign's.
 */
export default async function Home() {
  const user = await getCurrentUser();

  if (user !== null) {
    const mySpaces = await listMySpaces();
    const first = mySpaces[0];
    redirect(first === undefined ? "/onboarding" : `/${first.slug}`);
  }

  return (
    <SiteFrame>
      <h1 className="text-[34px] leading-[1.1] font-semibold tracking-[-0.03em] text-balance text-ink sm:text-[42px]">
        Your company&rsquo;s software, in one place.
      </h1>
      <p className="mt-4 max-w-[560px] text-[15px] leading-relaxed text-ink-muted">
        Cira runs the internal tools a company writes for itself - the dashboard, the
        importer, the Monday report - and gives everyone one place to open them. No cloud
        console, no deploy pipeline to keep, no link in a chat message that only works on
        one laptop.
      </p>

      <div className="mt-7 flex flex-wrap items-center gap-3">
        <Link href="/sign-up" className="btn btn-primary btn-lg">
          Start free for {PLANS.trial.trialDays} days
        </Link>
        <Link href="/docs" className="btn btn-secondary btn-lg">
          Read the docs
        </Link>
      </div>

      <div className="mt-14 grid gap-7 sm:grid-cols-3">
        {[
          {
            title: "Deploy what you already wrote",
            body: (
              <>
                Run <code className="font-mono text-[12.5px] text-ink">cira deploy</code>{" "}
                in the repository. Cira reads it as it is - its framework, its parts, the
                variables it needs, the workers and scheduled runs it declares - and puts
                it online.
              </>
            ),
          },
          {
            title: "One shelf for everyone",
            body: "Everybody at the company sees the apps they are allowed to open, and opens them without a VPN or a password of their own. You decide who sees what.",
          },
          {
            title: "Your agents can use it too",
            body: "Every app's operations become tools an assistant can search, read and run - as the person asking, with their permissions, and never with anyone else’s.",
          },
        ].map((point) => (
          <div key={point.title}>
            <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink">
              {point.title}
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
              {point.body}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-14 rounded-[var(--radius-edge)] border border-line bg-surface p-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
          What it costs
        </h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">
          ${PLANS.team.perSeatMonthly} per person a month, {PLANS.team.minimumSeats}{" "}
          people minimum. Apps that sleep when nobody is using them are included; anything
          that runs around the clock - a worker, or an app kept warm - is $
          {PLANS.team.workerMonthly} a month each, because that is what it costs to keep
          running.
        </p>
        <Link
          href="/pricing"
          className="mt-3 inline-block text-[13px] text-ink-muted underline underline-offset-4 transition-colors hover:text-ink"
        >
          See what a plan includes
        </Link>
      </div>
    </SiteFrame>
  );
}
