import { notFound } from "next/navigation";
import { AppCard } from "@/components/app-card";
import { AppShell } from "@/components/shell/app-shell";
import { PageTitle } from "@/components/shell/page-title";
import {
  NotFoundError,
  listMySpaces,
  listVisibleApps,
  requireSpaceMember,
} from "@/lib/authz";
import { recentlyOpened } from "@/lib/queries";
import { spaceTitle } from "@/lib/page-title";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ spaceSlug: string }>;
}) {
  return spaceTitle((await params).spaceSlug, "Recent");
}

export default async function RecentPage({
  params,
}: {
  params: Promise<{ spaceSlug: string }>;
}) {
  const { spaceSlug } = await params;

  try {
    const ctx = await requireSpaceMember(spaceSlug);
    const [apps, spaces] = await Promise.all([
      listVisibleApps(spaceSlug),
      listMySpaces(),
    ]);

    // Ordered by when this person last opened each, and filtered through what
    // they can still see: access removed since is access removed now.
    const order = await recentlyOpened(
      ctx.user.id,
      apps.map((a) => a.id),
      12,
    );
    const byId = new Map(apps.map((a) => [a.id, a]));
    const recent = order.flatMap((id) => {
      const app = byId.get(id);
      return app === undefined ? [] : [app];
    });

    return (
      <AppShell
        spaceSlug={spaceSlug}
        spaces={spaces}
        title={<PageTitle title="Recent" detail="Apps you have opened, newest first" />}
      >
        {recent.length === 0 ? (
          <div className="enter-fade rounded-[var(--radius-edge)] border border-dashed border-line-strong px-6 py-16 text-center">
            <h2 className="text-[15px] font-semibold text-ink">Nothing here yet</h2>
            <p className="mx-auto mt-1.5 max-w-[40ch] text-[13px] text-ink-muted">
              Apps appear here once you open them, so the ones you use most are always a
              click away.
            </p>
          </div>
        ) : (
          <ul className="grid auto-rows-fr grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {recent.map((app, index) => (
              <li key={app.id} className="min-w-0">
                <AppCard app={app} spaceSlug={spaceSlug} index={index} />
              </li>
            ))}
          </ul>
        )}
      </AppShell>
    );
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
