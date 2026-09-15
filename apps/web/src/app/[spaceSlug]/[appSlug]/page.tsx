import Link from "next/link";
import { notFound } from "next/navigation";
import { TopBar } from "@/components/top-bar";
import { NotFoundError, requireAppAccess } from "@/lib/authz";
import { latestDeployment } from "@/lib/queries";

export default async function AppPage({
  params,
}: {
  params: Promise<{ spaceSlug: string; appSlug: string }>;
}) {
  const { spaceSlug, appSlug } = await params;

  try {
    const { app, space } = await requireAppAccess(spaceSlug, appSlug);
    const deployment = await latestDeployment(app.id);

    return (
      <>
        <TopBar spaceSlug={spaceSlug} />

        <main className="mx-auto w-full max-w-3xl px-6 py-10">
          <Link
            href={`/${spaceSlug}`}
            className="text-sm text-ink-muted transition-colors hover:text-ink"
          >
            &larr; {space.name}
          </Link>

          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-ink">
            {app.name}
          </h1>

          {app.description !== null && app.description !== "" ? (
            <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
              {app.description}
            </p>
          ) : null}

          <div className="mt-7">
            {deployment !== null && deployment.url !== null && app.status === "live" ? (
              <a
                href={deployment.url}
                className="inline-flex rounded-xl bg-accent px-5 py-2.5 text-[15px] font-medium text-white transition-colors hover:bg-accent-hover"
              >
                Open
              </a>
            ) : (
              <p className="rounded-xl border border-border bg-surface px-5 py-4 text-[15px] text-ink-muted">
                This app has not finished deploying yet.
              </p>
            )}
          </div>
        </main>
      </>
    );
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
