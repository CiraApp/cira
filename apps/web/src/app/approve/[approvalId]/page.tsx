import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EntryFrame } from "@/components/entry-frame";
import { ApprovalDecision } from "@/components/approval-decision";
import { loadApproval } from "@/lib/approvals";
import { requireCurrentUser } from "@/lib/identity";

export const metadata: Metadata = { title: "Approve a change" };

const VIA: Record<string, string> = {
  mcp: "Your assistant",
  ask: "Ask Cira",
  console: "The console",
};

/**
 * Where a person decides on one change an assistant wants to make for them.
 *
 * Everything the change would do is on the page - which app, which operation,
 * and exactly what it would be sent - because agreeing to something unseen is
 * not agreeing. Only the person it acts for can open it; for anyone else the
 * page does not exist.
 */
export default async function ApprovePage({
  params,
}: {
  params: Promise<{ approvalId: string }>;
}) {
  const { approvalId } = await params;
  const user = await requireCurrentUser(`/approve/${encodeURIComponent(approvalId)}`);
  const approval = await loadApproval(user, approvalId);
  if (approval === null) notFound();

  const { capability } = approval;
  const who = VIA[approval.via] ?? "An assistant";
  const fields = Object.entries(approval.input);

  return (
    <EntryFrame
      eyebrow={capability.appName}
      title={`${humanName(capability.name)}?`}
      subtitle={`${who} wants to make this change in ${capability.appName} as you, ${user.name}. Nothing has happened yet.`}
    >
      <div className="rounded-[var(--radius-edge)] border border-line bg-surface px-4 py-3.5">
        <p className="text-[13px] leading-relaxed text-ink">{capability.description}</p>
        <p className="mt-1.5 font-mono text-[11.5px] text-ink-subtle">
          {capability.method} {capability.path}
        </p>
        {fields.length === 0 ? (
          <p className="mt-3 text-[12.5px] text-ink-muted">It sends nothing else.</p>
        ) : (
          <dl className="mt-3 divide-y divide-line border-t border-line">
            {fields.map(([key, value]) => (
              <div key={key} className="flex gap-4 py-2 text-[12.5px]">
                <dt className="w-[120px] shrink-0 truncate text-ink-subtle">{key}</dt>
                <dd className="min-w-0 flex-1 font-mono break-words text-ink">
                  {typeof value === "string" ? value : JSON.stringify(value)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <ApprovalDecision
        approvalId={approval.id}
        status={approval.status}
        expiresAt={approval.expiresAt.toISOString()}
      />
    </EntryFrame>
  );
}

/** `createRefund` as a person would say it. */
function humanName(name: string): string {
  const words = name
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
