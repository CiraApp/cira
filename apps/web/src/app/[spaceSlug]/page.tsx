import { notFound } from "next/navigation";
import { AppGallery } from "@/components/app-gallery";
import { EmptyGallery } from "@/components/empty-gallery";
import { TopBar } from "@/components/top-bar";
import { NotFoundError, listVisibleApps, requireSpaceMember } from "@/lib/authz";

export default async function SpacePage({
  params,
}: {
  params: Promise<{ spaceSlug: string }>;
}) {
  const { spaceSlug } = await params;

  try {
    const [{ space }, apps] = await Promise.all([
      requireSpaceMember(spaceSlug),
      listVisibleApps(spaceSlug),
    ]);

    return (
      <>
        <TopBar spaceSlug={spaceSlug} />

        <main className="mx-auto w-full max-w-5xl px-6 py-10">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{space.name}</h1>

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
