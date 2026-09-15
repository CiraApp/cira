import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, memberships, users } from "@cira/db";
import { AppShell } from "@/components/shell/app-shell";
import { PageTitle } from "@/components/shell/page-title";
import { InviteDialog } from "@/components/invite-dialog";
import { NotFoundError, listMySpaces, requireSpaceMember } from "@/lib/authz";

const ROLE_NOTE: Record<string, string> = {
  owner: "Full control of this space",
  admin: "Can manage apps and invite people",
  member: "Can use the apps they are given",
};

export default async function MembersPage({
  params,
}: {
  params: Promise<{ spaceSlug: string }>;
}) {
  const { spaceSlug } = await params;

  try {
    const ctx = await requireSpaceMember(spaceSlug);
    const spaces = await listMySpaces();
    const canInvite = ctx.role === "admin" || ctx.role === "owner";

    const rows = await db()
      .select({ user: users, role: memberships.role, joined: memberships.createdAt })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.spaceId, ctx.space.id));

    // Owners first, then admins, then everyone alphabetically: the list answers
    // "who do I ask" before it answers "who is here".
    const rank = { owner: 0, admin: 1, member: 2 } as const;
    const people = rows.sort(
      (a, b) => rank[a.role] - rank[b.role] || a.user.name.localeCompare(b.user.name),
    );

    return (
      <AppShell
        spaceSlug={spaceSlug}
        spaces={spaces}
        title={
          <PageTitle
            title="Members"
            detail={`${people.length} ${people.length === 1 ? "person" : "people"} in ${ctx.space.name}`}
          />
        }
        actions={canInvite ? <InviteDialog spaceSlug={spaceSlug} /> : null}
      >
        <ul className="enter-up max-w-[760px] divide-y divide-line overflow-hidden rounded-[var(--radius-edge)] border border-line bg-surface">
          {people.map((person) => (
            <li
              key={person.user.id}
              className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-sunken/50"
            >
              <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-edge)] border border-line bg-sunken text-[12px] font-semibold text-ink-muted"
              >
                {person.user.name.charAt(0).toUpperCase()}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">
                  {person.user.name}
                </span>
                <span className="block truncate text-[12px] text-ink-subtle">
                  {person.user.email}
                </span>
              </span>

              <span className="hidden text-right sm:block">
                <span className="block text-[12px] font-medium text-ink capitalize">
                  {person.role}
                </span>
                <span className="block text-[11px] text-ink-subtle">
                  {ROLE_NOTE[person.role]}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </AppShell>
    );
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
