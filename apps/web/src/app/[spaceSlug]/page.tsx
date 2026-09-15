import { notFound } from "next/navigation";
import { AppGallery } from "@/components/app-gallery";
import { EmptyGallery } from "@/components/empty-gallery";
import { SpaceSwitcher } from "@/components/space-switcher";
import { TopBar } from "@/components/top-bar";
import {
  NotFoundError,
  listMySpaces,
  listVisibleApps,
  requireSpaceMember,
} from "@/lib/authz";

export default async function SpacePage({
  params,
}: {
  params: Promise<{ spaceSlug: string }>;
}) {
  const { spaceSlug } = await params;

  try {
    await requireSpaceMember(spaceSlug);
    const [apps, spaces] = await Promise.all([
      listVisibleApps(spaceSlug),
      listMySpaces(),
    ]);

    return (
      <>
        <TopBar spaceSlug={spaceSlug} />

        <main className="mx-auto w-full max-w-5xl px-6 py-10">
          <SpaceSwitcher spaces={spaces} currentSlug={spaceSlug} />

          <div className="mt-7">
            {apps.length === 0 ? (
              <EmptyGallery />
            ) : (
              <AppGallery apps={apps} spaceSlug={spaceSlug} />
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
