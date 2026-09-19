import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { PageTitle } from "@/components/shell/page-title";
import { NotFoundError, listMySpaces, requireSpaceMember } from "@/lib/authz";
import { describeDollars, describeInstanceTime, roleAtLeast } from "@cira/core";
import { monthSoFar, spaceUsage } from "@/lib/usage";

/**
 * What this company used this month, and what running it cost.
 *
 * Shown to admins and owners: it is the number a plan has to cover, and
 * whoever pays should be able to see it before an invoice explains it. Asked
 * of Google when the page is opened, like every other reading in Cira.
 */
export default async function UsagePage({
  params,
}: {
  params: Promise<{ spaceSlug: string }>;
}) {
  const { spaceSlug } = await params;

  try {
    const ctx = await requireSpaceMember(spaceSlug);
    if (!roleAtLeast(ctx.role, "admin")) notFound();

    const [spaces, outcome] = await Promise.all([
      listMySpaces(),
      spaceUsage(ctx.space.id, monthSoFar()),
    ]);

    const month = new Date().toLocaleDateString("en-US", {
      month: "long",
      timeZone: "UTC",
    });

    return (
      <AppShell
        spaceSlug={spaceSlug}
        spaces={spaces}
        title={
          <PageTitle title="Usage" detail={`What ${ctx.space.name} has run this month`} />
        }
      >
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

            <ul className="mt-5 divide-y divide-line overflow-hidden rounded-[var(--radius-edge)] border border-line bg-surface">
              {outcome.usage.apps.length === 0 ? (
                <li className="px-4 py-3.5 text-[13px] text-ink-muted">
                  Nothing has been deployed here yet.
                </li>
              ) : (
                outcome.usage.apps.map((app) => (
                  <li
                    key={app.appId}
                    className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 transition-colors duration-150 hover:bg-sunken/40"
                  >
                    <Link
                      href={`/${spaceSlug}/${app.slug}`}
                      className="min-w-0 flex-1 truncate text-[13px] text-ink underline-offset-4 hover:underline"
                    >
                      {app.name}
                    </Link>
                    <span className="tabular w-[92px] text-right text-[12.5px] text-ink-muted">
                      {describeInstanceTime(app.instanceSeconds)}
                    </span>
                    <span className="tabular w-[104px] text-right text-[12.5px] text-ink-muted">
                      {app.requests.toLocaleString()} req
                    </span>
                    <span className="tabular w-[76px] text-right text-[12.5px] text-ink">
                      {describeDollars(app.dollars)}
                    </span>
                  </li>
                ))
              )}
            </ul>

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
