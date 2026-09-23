import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { PageTitle } from "@/components/shell/page-title";
import { NotFoundError, listMySpaces, requireSpaceMember } from "@/lib/authz";
import { count, eq } from "drizzle-orm";
import { apps, db } from "@cira/db";
import { roleAtLeast } from "@cira/core";
import { LeaveCira } from "@/components/leave-cira";
import { SpaceSettingsForm } from "@/components/space-settings-form";
import { spaceTitle } from "@/lib/page-title";
import { appOrigin } from "@/lib/email";
import { CompanySignIn } from "@/components/company-sign-in";
import { ssoFor } from "@/lib/sso";
import { SCIM_PATH, scimStatus } from "@/lib/scim";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ spaceSlug: string }>;
}) {
  return spaceTitle((await params).spaceSlug, "Settings");
}

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ spaceSlug: string }>;
}) {
  const { spaceSlug } = await params;

  try {
    const ctx = await requireSpaceMember(spaceSlug);
    const [spaces, [counted]] = await Promise.all([
      listMySpaces(),
      db().select({ n: count() }).from(apps).where(eq(apps.spaceId, ctx.space.id)),
    ]);
    const appCount = counted?.n ?? 0;
    // How the company's people get in, for the admins who decide it.
    const admin = roleAtLeast(ctx.role, "admin")
      ? {
          sso: await ssoFor(ctx.space.id),
          scim: await scimStatus(ctx.space.id),
        }
      : null;

    // `capitalize` is per fact, not on the whole list: a slug is an address and
    // a sentence is a sentence, and title-casing either turns a true statement
    // into "/Acme" and "Anyone With A Verified @Ciraapp.Dev Address".
    const facts: Array<{ label: string; value: string; capitalize?: boolean }> = [
      { label: "Space name", value: ctx.space.name },
      { label: "Address", value: `/${ctx.space.slug}` },
      {
        label: "Joining",
        value:
          ctx.space.domain !== null && ctx.space.joinByDomain
            ? `By invite, or with a verified @${ctx.space.domain} address`
            : "By invite only",
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

          {roleAtLeast(ctx.role, "admin") ? (
            <div className="mt-4 flex flex-col gap-1.5 text-[12.5px]">
              <Link
                href={`/${spaceSlug}/~/usage`}
                className="text-ink-muted underline-offset-4 transition-colors hover:text-ink hover:underline"
              >
                Billing, and what this space has run this month
              </Link>
              <Link
                href={`/${spaceSlug}/~/changes`}
                className="text-ink-muted underline-offset-4 transition-colors hover:text-ink hover:underline"
              >
                Changes: who changed roles, access and how people sign in
              </Link>
            </div>
          ) : null}

          {roleAtLeast(ctx.role, "admin") ? (
            <SpaceSettingsForm
              spaceSlug={spaceSlug}
              name={ctx.space.name}
              domain={ctx.space.domain}
              joinByDomain={ctx.space.joinByDomain}
            />
          ) : null}

          {admin !== null ? (
            <CompanySignIn
              spaceSlug={spaceSlug}
              domain={ctx.space.domain}
              sso={admin.sso}
              scim={
                admin.scim === null
                  ? null
                  : {
                      lastUsedAt: admin.scim.lastUsedAt?.toISOString() ?? null,
                      people: admin.scim.people,
                    }
              }
              scimBase={`${appOrigin()}${SCIM_PATH}`}
            />
          ) : null}

          <p className="mt-6 text-[12px] leading-relaxed text-ink-subtle">
            An app&rsquo;s own settings live on its page. People, roles and teams are on{" "}
            <Link
              href={`/${spaceSlug}/~/members`}
              className="text-ink-muted underline-offset-4 hover:text-ink hover:underline"
            >
              Members
            </Link>
            .
          </p>

          <LeaveCira
            spaceSlug={spaceSlug}
            spaceName={ctx.space.name}
            apps={appCount}
            canDelete={roleAtLeast(ctx.role, "owner")}
          />
        </div>
      </AppShell>
    );
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
