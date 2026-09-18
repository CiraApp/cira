import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { PageTitle } from "@/components/shell/page-title";
import { ProfileForm } from "@/components/profile-form";
import { NotFoundError, listMySpaces, requireSpaceMember } from "@/lib/authz";

/**
 * How Cira knows you.
 *
 * Yours rather than the space's, so it is the same page whichever space it is
 * opened from - it lives under one only so the sidebar and header come with
 * it. Your name is Cira's to keep and yours to change; your email is whatever
 * you sign in with, and changing it is the sign-in provider's business.
 */
export default async function ProfilePage({
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
        title={
          <PageTitle title="Your profile" detail="How Cira and your team know you" />
        }
      >
        <div className="enter-up flex max-w-[620px] flex-col gap-3">
          <section className="rounded-[var(--radius-edge)] border border-line bg-surface p-4 sm:p-5">
            <ProfileForm
              firstName={ctx.user.firstName ?? null}
              lastName={ctx.user.lastName ?? null}
            />
          </section>

          <dl className="overflow-hidden rounded-[var(--radius-edge)] border border-line bg-surface">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 px-4 py-3.5">
              <dt className="w-[130px] shrink-0 text-[12px] text-ink-subtle">Email</dt>
              <dd className="min-w-0 flex-1 text-[13px] break-all text-ink">
                {ctx.user.email}
              </dd>
            </div>
          </dl>

          <p className="text-[12px] leading-relaxed text-ink-subtle">
            Your email is the one you sign in with. Your name is shown to everyone in the
            spaces you belong to.
          </p>
        </div>
      </AppShell>
    );
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
