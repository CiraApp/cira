import Link from "next/link";
import { notFound } from "next/navigation";
import { AmbientField } from "@/components/ambient-field";
import { AppIcon } from "@/components/app-icon";
import { CiraMark } from "@/components/shell/mark";
import { NotFoundError, requireAppAccess } from "@/lib/authz";
import { listCapabilitiesForApp } from "@/lib/capabilities";
import { latestDeployment } from "@/lib/queries";
import { appTitle } from "@/lib/page-title";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ spaceSlug: string; appSlug: string }>;
}) {
  const { spaceSlug, appSlug } = await params;
  return appTitle(spaceSlug, appSlug);
}

const RISK_NOTE: Record<string, string> = {
  read: "Returns information",
  write: "Changes something",
  destructive: "Cannot be undone",
};

/**
 * Where a synthetic app's Open button lands.
 *
 * The demo company's apps have no code and nothing running behind them, and
 * the honest thing to do about that is say so on a real page rather than hand
 * someone a DNS error. It stands in for the deployed app: outside Cira's
 * chrome, because that is what opening an app is like, and gated by exactly
 * the access check the real door uses.
 *
 * Only ever rendered for a deployment this repository seeded. A real app is
 * not found here, so nobody can reach a fake console for something that
 * actually exists.
 */
export default async function DemoAppPage({
  params,
}: {
  params: Promise<{ spaceSlug: string; appSlug: string }>;
}) {
  const { spaceSlug, appSlug } = await params;

  try {
    const ctx = await requireAppAccess(spaceSlug, appSlug);
    const deployment = await latestDeployment(ctx.app.id);
    if (deployment?.provider !== "demo") notFound();

    const capabilities = await listCapabilitiesForApp(ctx.app.id);

    return (
      <>
        <AmbientField />

        <main className="mx-auto w-full max-w-[720px] px-6 py-14">
          <div className="enter-up flex items-start gap-4">
            <AppIcon
              appId={ctx.app.id}
              name={ctx.app.name}
              icon={ctx.app.icon}
              size="lg"
            />
            <div className="min-w-0 flex-1 pt-1">
              <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.02em] text-ink">
                {ctx.app.name}
              </h1>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-muted">
                {ctx.app.description}
              </p>
            </div>
          </div>

          <div
            className="enter-up mt-8 rounded-[var(--radius-edge)] border border-line bg-surface p-5"
            style={{ animationDelay: "80ms" }}
          >
            <p className="eyebrow">Not a real app</p>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
              {ctx.app.name} is part of a synthetic company built to show what Cira looks
              like once a business is using it. There is no code behind this page. A real
              app would be your own Next.js project, deployed with{" "}
              <code className="rounded-[2px] bg-sunken px-1 py-0.5 font-mono text-[12px] text-ink">
                cira deploy
              </code>
              , and Cira would have found the operations below by reading it.
            </p>
          </div>

          {capabilities.length > 0 ? (
            <section className="enter-up mt-9" style={{ animationDelay: "140ms" }}>
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">
                  What it does
                </h2>
                <p className="text-[12px] text-ink-subtle">
                  {capabilities.filter((c) => c.enabled).length} of {capabilities.length}{" "}
                  available to agents
                </p>
              </div>

              <ul className="mt-3 divide-y divide-line overflow-hidden rounded-[var(--radius-edge)] border border-line bg-surface">
                {capabilities.map((capability) => (
                  <li key={capability.id} className="px-4 py-3">
                    <div className="flex items-baseline gap-3">
                      <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">
                        {capability.name}
                      </span>
                      <span
                        className={`shrink-0 text-[11px] ${
                          capability.enabled ? "text-live" : "text-ink-subtle"
                        }`}
                      >
                        {capability.enabled ? "Live" : "Off"}
                      </span>
                    </div>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
                      {capability.description}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-ink-subtle">
                      {capability.target.method} {capability.target.path} ·{" "}
                      {RISK_NOTE[capability.risk]}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div
            className="enter-up mt-9 flex items-center justify-between gap-4 border-t border-line pt-5"
            style={{ animationDelay: "200ms" }}
          >
            <Link
              href={`/${spaceSlug}/${appSlug}`}
              className="group inline-flex items-center gap-1.5 text-[12.5px] text-ink-muted transition-colors duration-150 hover:text-ink"
            >
              <svg
                viewBox="0 0 12 12"
                aria-hidden="true"
                className="h-3 w-3 transition-transform duration-300 ease-[var(--ease-spring)] group-hover:-translate-x-0.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9.5 6h-7M5.5 3l-3 3 3 3" />
              </svg>
              Back to {ctx.app.name} in Cira
            </Link>

            <span className="flex items-center gap-1.5 text-ink-subtle">
              <CiraMark className="h-[13px] w-auto" />
              <span className="text-[11.5px]">Opened through Cira</span>
            </span>
          </div>
        </main>
      </>
    );
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
