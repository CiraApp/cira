import Link from "next/link";
import type { Metadata } from "next";
import { monthlyCost, PLANS } from "@cira/core";
import { SiteFrame } from "@/components/site/site-frame";

export const metadata: Metadata = {
  title: "Pricing",
  description: "What Cira costs, and what each plan includes.",
};

/**
 * What Cira costs, read from the same record the product enforces
 * (core's plans.ts and limits.ts), so this page cannot promise an allowance
 * the server refuses or a price an invoice disagrees with.
 */
export default function PricingPage() {
  const { trial, team } = PLANS;
  const limits = team.limits;

  return (
    <SiteFrame wide>
      <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.02em] text-ink">
        Pricing
      </h1>
      <p className="mt-3 max-w-[620px] text-[14px] leading-relaxed text-ink-muted">
        Per person, because that is where the value is. The only extras are the things
        that run around the clock, which are the only things that cost real money to keep
        running.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-[var(--radius-edge)] border border-line bg-surface p-6">
          <h2 className="text-[15px] font-semibold text-ink">{trial.name}</h2>
          <p className="mt-1 text-[24px] font-semibold tracking-[-0.02em] text-ink">
            Free
          </p>
          <p className="mt-1 text-[12.5px] text-ink-subtle">
            {trial.trialDays} days, no card
          </p>
          <ul className="mt-4 flex flex-col gap-2 text-[13px] text-ink-muted">
            {[
              `Up to ${trial.limits.appsPerSpace} apps`,
              `${trial.limits.processes.workersPerSpace} worker`,
              `${trial.limits.processes.scheduledPerSpace} scheduled runs`,
              "Everyone at the company, and their agents",
            ].map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <Link href="/sign-up" className="btn btn-secondary mt-5 w-full justify-center">
            Start
          </Link>
        </div>

        <div className="rounded-[var(--radius-edge)] border border-line-strong bg-raised p-6">
          <h2 className="text-[15px] font-semibold text-ink">{team.name}</h2>
          <p className="mt-1 text-[24px] font-semibold tracking-[-0.02em] text-ink">
            ${team.perSeatMonthly}
            <span className="text-[13px] font-normal text-ink-subtle">
              {" "}
              per person a month
            </span>
          </p>
          <p className="mt-1 text-[12.5px] text-ink-subtle">
            {team.minimumSeats} people minimum
          </p>
          <ul className="mt-4 flex flex-col gap-2 text-[13px] text-ink-muted">
            {[
              `Up to ${limits.appsPerSpace} apps, each up to ${limits.app.maxInstances} instances`,
              `${limits.processes.scheduledPerSpace} scheduled runs, as often as every ${limits.processes.minIntervalMinutes} minutes`,
              `$${team.workerMonthly} a month for each worker that runs all the time`,
              `$${team.alwaysOnMonthly} a month to keep an app warm, so its first request never waits`,
              "Runtime logs, who ran what, and email when something breaks",
            ].map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <Link href="/sign-up" className="btn btn-primary mt-5 w-full justify-center">
            Start free, pay later
          </Link>
        </div>
      </div>

      <div className="mt-10 max-w-[620px] text-[13px] leading-relaxed text-ink-muted">
        <h2 className="text-[13.5px] font-semibold text-ink">Why the extras</h2>
        <p className="mt-2">
          An app on Cira sleeps when nobody is using it, so most apps cost pennies a month
          to run and are covered by the seat price. A worker, or an app kept warm, holds a
          machine open every hour of every day - about $
          {Math.round(monthlyCost({ cpu: 1, memoryMiB: 1024 }))} a month of real cost
          each. Those are the only things billed separately, and you switch them on
          yourself.
        </p>
        <h2 className="mt-6 text-[13.5px] font-semibold text-ink">
          What happens if a payment fails
        </h2>
        <p className="mt-2">
          Nothing stops. Your company&rsquo;s software keeps running and Cira tells you
          the card needs attention. A subscription that ends goes back to the trial
          allowance, and nothing is deleted.
        </p>
        <h2 className="mt-6 text-[13.5px] font-semibold text-ink">Leaving</h2>
        <p className="mt-2">
          Export everything Cira holds about your company as one file, whenever you like,
          and delete the space when you are done. See{" "}
          <Link href="/legal/privacy" className="underline underline-offset-4">
            privacy
          </Link>
          .
        </p>
      </div>
    </SiteFrame>
  );
}
