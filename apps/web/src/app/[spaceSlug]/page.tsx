import { notFound } from "next/navigation";
import { AppGallery } from "@/components/app-gallery";
import { EmptyGallery } from "@/components/empty-gallery";
import { RecentStrip } from "@/components/recent-strip";
import { InviteDialog } from "@/components/invite-dialog";
import { AppShell } from "@/components/shell/app-shell";
import { PageTitle } from "@/components/shell/page-title";
import {
  NotFoundError,
  listMySpaces,
  listVisibleApps,
  requireSpaceMember,
} from "@/lib/authz";
import { recentlyOpened, teamsInSpace } from "@/lib/queries";
import { emailConfigured } from "@/lib/email";
import { spaceTitle } from "@/lib/page-title";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ spaceSlug: string }>;
}) {
  return spaceTitle((await params).spaceSlug);
}

export default async function SpacePage({
  params,
}: {
  params: Promise<{ spaceSlug: string }>;
}) {
  const { spaceSlug } = await params;

  try {
    const ctx = await requireSpaceMember(spaceSlug);
    const canInvite = ctx.role === "admin" || ctx.role === "owner";
    const [apps, spaces, teams] = await Promise.all([
      listVisibleApps(spaceSlug),
      listMySpaces(),
      canInvite ? teamsInSpace(ctx.space.id) : [],
    ]);

    // The shortcut row only earns its place once there is something to skip
    // past, so it stays hidden until the shelf is big enough to scan.
    const recentIds =
      apps.length > 4
        ? await recentlyOpened(
            ctx.user.id,
            apps.map((a) => a.id),
            6,
          )
        : [];
    const byId = new Map(apps.map((a) => [a.id, a]));
    const recent = recentIds.flatMap((id) => {
      const app = byId.get(id);
      return app === undefined ? [] : [app];
    });

    return (
      <AppShell
        spaceSlug={spaceSlug}
        spaces={spaces}
        title={
          <PageTitle
            title="Apps"
            detail={`${apps.length} ${apps.length === 1 ? "app" : "apps"} you can open`}
          />
        }
        actions={
          canInvite ? (
            <InviteDialog
              spaceSlug={spaceSlug}
              emailing={emailConfigured()}
              teams={teams}
            />
          ) : null
        }
      >
        {apps.length === 0 ? (
          <EmptyGallery />
        ) : (
          <AppGallery
            apps={apps}
            spaceSlug={spaceSlug}
            // The name they gave Cira, never the sign-in provider's, which for
            // an account with no name on it is an email address.
            firstName={ctx.user.firstName ?? undefined}
            between={<RecentStrip apps={recent} spaceSlug={spaceSlug} />}
          />
        )}
      </AppShell>
    );
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
