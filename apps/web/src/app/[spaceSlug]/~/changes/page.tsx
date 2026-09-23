import { notFound } from "next/navigation";
import Link from "next/link";
import { roleAtLeast } from "@cira/core";
import { AppShell } from "@/components/shell/app-shell";
import { PageTitle } from "@/components/shell/page-title";
import { ChangeList } from "@/components/change-list";
import { NotFoundError, listMySpaces, requireSpaceMember } from "@/lib/authz";
import { changesIn } from "@/lib/change-record";
import { spaceTitle } from "@/lib/page-title";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ spaceSlug: string }>;
}) {
  return spaceTitle((await params).spaceSlug, "Changes");
}

/**
 * Who changed what about this company.
 *
 * For admins and owners, because it is a list of everything the people with
 * power here have done with it: made someone an admin, let an agent write,
 * put sign-in behind the company's own provider. The other half - who *ran*
 * what - sits on each app's own page, where the app it was run against is.
 */
export default async function ChangesPage({
  params,
}: {
  params: Promise<{ spaceSlug: string }>;
}) {
  const { spaceSlug } = await params;

  try {
    const ctx = await requireSpaceMember(spaceSlug);
    if (!roleAtLeast(ctx.role, "admin")) notFound();

    const [spaces, changes] = await Promise.all([
      listMySpaces(),
      changesIn(ctx.space.id, 200),
    ]);

    return (
      <AppShell
        spaceSlug={spaceSlug}
        spaces={spaces}
        title={
          <PageTitle
            title="Changes"
            detail={`Who changed what about ${ctx.space.name}`}
          />
        }
      >
        <div className="enter-up max-w-[720px]">
          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            Roles, access, teams, what agents may run, addresses and how people sign in.
            Kept from the moment each change was made, and never edited afterwards.
            Nothing here holds a secret, a variable&rsquo;s value or anything anyone sent
            to an app.
          </p>

          <ChangeList
            changes={changes.map((change) => ({
              id: change.id,
              kind: change.kind,
              actor: change.actor,
              subject: change.subject,
              detail: change.detail,
              at: change.at.toISOString(),
            }))}
          />

          <p className="mt-6 text-[12.5px] text-ink-subtle">
            Who ran what is on each app&rsquo;s own page, under Capability runs.{" "}
            <Link
              href={`/${spaceSlug}/~/settings`}
              className="text-ink-muted underline underline-offset-4 hover:text-ink"
            >
              Back to settings
            </Link>
          </p>
        </div>
      </AppShell>
    );
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
