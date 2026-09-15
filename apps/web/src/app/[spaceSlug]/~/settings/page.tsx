import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { PageTitle } from "@/components/shell/page-title";
import { NotFoundError, listMySpaces, requireSpaceMember } from "@/lib/authz";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ spaceSlug: string }>;
}) {
  const { spaceSlug } = await params;

  try {
    const ctx = await requireSpaceMember(spaceSlug);
    const spaces = await listMySpaces();

    // `capitalize` is per fact, not on the whole list: a slug is an address and
    // a sentence is a sentence, and title-casing either turns a true statement
    // into "/Acme" and "Anyone With A Verified @Ciraapp.Dev Address".
    const facts: Array<{ label: string; value: string; capitalize?: boolean }> = [
      { label: "Space name", value: ctx.space.name },
      { label: "Address", value: `/${ctx.space.slug}` },
      {
        label: "Joining",
        value:
          ctx.space.domain === null
            ? "By invite only"
            : `Anyone with a verified @${ctx.space.domain} address`,
      },
      { label: "Your role", value: ctx.role, capitalize: true },
    ];

    return (
      <AppShell
        spaceSlug={spaceSlug}
        spaces={spaces}
        title={<PageTitle title="Settings" detail={`How ${ctx.space.name} is set up`} />}
      >
        <div className="enter-up max-w-[620px]">
          <dl className="divide-y divide-line overflow-hidden rounded-[var(--radius-edge)] border border-line bg-surface">
            {facts.map((fact) => (
              <div
                key={fact.label}
                className="flex flex-wrap items-baseline gap-x-6 gap-y-1 px-4 py-3.5 transition-colors duration-150 hover:bg-sunken/40"
              >
                <dt className="w-[130px] shrink-0 text-[12px] text-ink-subtle">
                  {fact.label}
                </dt>
                <dd
                  className={`min-w-0 flex-1 text-[13px] text-ink ${
                    fact.capitalize === true ? "capitalize" : ""
                  }`}
                >
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>

          <p className="mt-3 text-[12px] leading-relaxed text-ink-subtle">
            Renaming a space and changing who may join are not built yet. An app&rsquo;s
            own settings live on its page.
          </p>
        </div>
      </AppShell>
    );
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
