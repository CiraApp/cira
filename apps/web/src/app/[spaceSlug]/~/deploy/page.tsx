import { notFound } from "next/navigation";
import { count, eq } from "drizzle-orm";
import { apps, db } from "@cira/db";
import { DEFAULT_LIMITS } from "@cira/core";
import { AppShell } from "@/components/shell/app-shell";
import { PageTitle } from "@/components/shell/page-title";
import { DeployGuide } from "@/components/deploy-guide";
import { NotFoundError, listMySpaces, requireSpaceMember } from "@/lib/authz";

export default async function DeployPage({
  params,
}: {
  params: Promise<{ spaceSlug: string }>;
}) {
  const { spaceSlug } = await params;

  try {
    const ctx = await requireSpaceMember(spaceSlug);
    const [spaces, [held]] = await Promise.all([
      listMySpaces(),
      db().select({ n: count() }).from(apps).where(eq(apps.spaceId, ctx.space.id)),
    ]);

    return (
      <AppShell
        spaceSlug={spaceSlug}
        spaces={spaces}
        title={<PageTitle title="Deploy" detail={`Ship an app into ${ctx.space.name}`} />}
      >
        <DeployGuide
          spaceSlug={spaceSlug}
          appCount={held?.n ?? 0}
          limits={DEFAULT_LIMITS}
        />
      </AppShell>
    );
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
