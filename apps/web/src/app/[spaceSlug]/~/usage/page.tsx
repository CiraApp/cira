import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { PageTitle } from "@/components/shell/page-title";
import { NotFoundError, listMySpaces, requireSpaceMember } from "@/lib/authz";
import {
  describeDollars,
  describeInstanceTime,
  describePlan,
  roleAtLeast,
} from "@cira/core";
import { BillingButton } from "@/components/billing-button";
import { ConfirmingPayment } from "@/components/confirming-payment";
import { noticeFor } from "@/lib/billing-rules";
import { planSummary } from "@/lib/plan";
import { monthSoFar, spaceUsage } from "@/lib/usage";
import { spaceTitle } from "@/lib/page-title";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ spaceSlug: string }>;
}) {
  return spaceTitle((await params).spaceSlug, "Billing");
}

/**
 * What this company used this month, and what running it cost.
 *
 * Shown to admins and owners: it is the number a plan has to cover, and
 * whoever pays should be able to see it before an invoice explains it. Asked
 * of Google when the page is opened, like every other reading in Cira.
 */
export default async function UsagePage({
  params,
  searchParams,
}: {
  params: Promise<{ spaceSlug: string }>;
  searchParams: Promise<{ paid?: string }>;
}) {
  const [{ spaceSlug }, { paid }] = await Promise.all([params, searchParams]);

  try {
    const ctx = await requireSpaceMember(spaceSlug);
    if (!roleAtLeast(ctx.role, "admin")) notFound();

    const [spaces, outcome, plan] = await Promise.all([
      listMySpaces(),
      spaceUsage(ctx.space.id, monthSoFar()),
      planSummary(ctx.space.id),
    ]);

    const notice = noticeFor(plan.status);
    const month = new Date().toLocaleDateString("en-US", {
      month: "long",
      timeZone: "UTC",
    });

    return (
      <AppShell
        spaceSlug={spaceSlug}
        spaces={spaces}
        title={
          <PageTitle
            title="Billing"
            detail={`What ${ctx.space.name} pays, and what it has run`}
          />
        }
      >
        <section className="enter-up mb-7 max-w-[720px] rounded-[var(--radius-edge)] border border-line bg-surface px-4 py-3.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <p className="text-[13px] text-ink">
              {plan.plan.name}
              <span className="text-ink-subtle"> · {describePlan(plan.plan)}</span>
            </p>
            <p className="tabular text-[13px] text-ink">
              {plan.bill.dollars === 0
                ? "No charge yet"
                : `${describeDollars(plan.bill.dollars)} a month`}
            </p>
          </div>
          <div className="mt-3">
            {paid === "1" && !plan.subscribed ? (
              // Back from checkout before Stripe's word has arrived. Saying
              // "Trial" with a Subscribe button here invited a second payment.
              <ConfirmingPayment />
            ) : (
              <BillingButton
                spaceSlug={spaceSlug}
                subscribed={plan.subscribed}
                customer={plan.customer}
              />
            )}
          </div>

          <p className="mt-3 text-[12px] text-ink-subtle">
            {plan.people} {plan.people === 1 ? "person" : "people"}
            {plan.bill.seats > plan.people ? ` (billed as ${plan.bill.seats})` : ""},{" "}
            {plan.workers} {plan.workers === 1 ? "worker" : "workers"} switched on
            {plan.trialEndsAt === null
              ? ""
              : `. ${plan.plan.id === "lapsed" ? "The trial ended on" : "Trial runs to"} ${plan.trialEndsAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`}
            .
          </p>
        </section>

        {notice !== null ? (
          <p
            role="status"
            className={`enter-up mb-5 max-w-[720px] rounded-[var(--radius-edge)] border px-4 py-3 text-[12.5px] leading-relaxed ${
              notice.tone === "stop"
                ? "border-failed/40 bg-failed/5 text-failed"
                : "border-pending/40 bg-pending/5 text-pending"
            }`}
          >
            {notice.message}
          </p>
        ) : null}

        {!outcome.ok ? (
          <p className="enter-up max-w-[620px] text-[13px] leading-relaxed text-ink-muted">
            {WHY[outcome.reason]}
          </p>
        ) : (
          <div className="enter-up max-w-[720px]">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <p className="text-[26px] leading-none font-semibold tracking-[-0.02em] text-ink">
                {describeDollars(outcome.usage.dollars)}
              </p>
              <p className="text-[12.5px] text-ink-muted">
                of compute in {month} so far, across{" "}
                {describeInstanceTime(outcome.usage.instanceSeconds)} of running time
              </p>
            </div>

            {outcome.usage.apps.length === 0 ? (
              <p className="mt-5 rounded-[var(--radius-edge)] border border-line bg-surface px-4 py-3.5 text-[13px] text-ink-muted">
                Nothing has been deployed here yet.
              </p>
            ) : (
              // A table, headed: each figure used to be a bare "12m" or
              // "$0.40" in a row, which a screen reader read with nothing to say
              // what it measured, and which the eye had to guess at too.
              <div className="mt-5 overflow-hidden rounded-[var(--radius-edge)] border border-line bg-surface">
                <table className="w-full border-collapse text-left">
                  <caption className="sr-only">Compute by app in {month}</caption>
                  <thead>
                    <tr className="border-b border-line text-[11.5px] text-ink-subtle">
                      <th scope="col" className="px-4 py-2 font-medium">
                        App
                      </th>
                      <th
                        scope="col"
                        className="hidden w-[104px] px-2 py-2 text-right font-medium sm:table-cell"
                      >
                        Running time
                      </th>
                      <th
                        scope="col"
                        className="hidden w-[104px] px-2 py-2 text-right font-medium sm:table-cell"
                      >
                        Requests
                      </th>
                      <th
                        scope="col"
                        className="w-[92px] px-4 py-2 text-right font-medium"
                      >
                        Cost
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {outcome.usage.apps.map((app) => (
                      <tr
                        key={app.appId}
                        className="align-baseline transition-colors duration-150 hover:bg-sunken/40"
                      >
                        <th
                          scope="row"
                          className="max-w-0 px-4 py-3 text-left text-[13px] font-normal"
                        >
                          {app.slug === null ? (
                            <span className="block truncate text-ink-muted">
                              {app.name}{" "}
                              <span className="text-ink-subtle">(removed)</span>
                            </span>
                          ) : (
                            <Link
                              href={`/${spaceSlug}/${app.slug}`}
                              className="block truncate text-ink underline-offset-4 hover:underline"
                            >
                              {app.name}
                            </Link>
                          )}
                          {/* On a phone the two middle columns go, and what
                              they said goes under the name instead. */}
                          <span className="tabular mt-0.5 block text-[12px] text-ink-subtle sm:hidden">
                            {describeInstanceTime(app.instanceSeconds)} running,{" "}
                            {app.requests.toLocaleString()} requests
                          </span>
                        </th>
                        <td className="tabular hidden px-2 py-3 text-right text-[12.5px] text-ink-muted sm:table-cell">
                          {describeInstanceTime(app.instanceSeconds)}
                        </td>
                        <td className="tabular hidden px-2 py-3 text-right text-[12.5px] text-ink-muted sm:table-cell">
                          {app.requests.toLocaleString()}
                        </td>
                        <td className="tabular px-4 py-3 text-right text-[12.5px] text-ink">
                          {describeDollars(app.dollars)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <dl className="mt-5 flex flex-wrap gap-x-10 gap-y-3">
              {[
                { label: "Deploys", value: outcome.usage.deploys },
                { label: "Capability runs", value: outcome.usage.capabilityRuns },
                { label: "Questions asked", value: outcome.usage.questions },
              ].map((fact) => (
                <div key={fact.label}>
                  <dt className="text-[12px] text-ink-subtle">{fact.label}</dt>
                  <dd className="tabular mt-0.5 text-[15px] text-ink">
                    {fact.value.toLocaleString()}
                  </dd>
                </div>
              ))}
            </dl>

            <p className="mt-6 text-[12px] leading-relaxed text-ink-subtle">
              An estimate of what Google charges Cira to run your apps, from the time each
              spent running and the requests it answered. It is not a bill, and it does
              not count Cira itself.
            </p>
          </div>
        )}
      </AppShell>
    );
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

const WHY: Record<"not-allowed" | "disabled" | "unavailable", string> = {
  "not-allowed": "Cira is not allowed to read this project's usage yet.",
  disabled: "Usage reporting is switched off for this Google Cloud project.",
  unavailable: "Usage could not be read just now. Try again in a minute.",
};
