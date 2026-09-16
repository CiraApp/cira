import { notFound } from "next/navigation";
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
    const spaces = await listMySpaces();

    return (
      <AppShell
        spaceSlug={spaceSlug}
        spaces={spaces}
        title={<PageTitle title="Deploy" detail={`Ship an app into ${ctx.space.name}`} />}
      >
        <DeployGuide spaceSlug={spaceSlug} />
      </AppShell>
    );
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
