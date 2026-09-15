"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Capability } from "@cira/core";
import { setCapabilityEnabled } from "@/lib/capability-actions";

/**
 * What Cira found this app can do.
 *
 * Grouped by what the app would have to be trusted with rather than by name,
 * because that is the only question worth answering here: the enabled ones are
 * already answering agents, and everything else is waiting on a person.
 *
 * Nobody wrote any of this. It is the detected set, and the only control is a
 * switch - the spec is explicit that this should not become a moderation
 * workflow.
 */
export function CapabilityPanel({
  capabilities,
  canManage,
}: {
  capabilities: Capability[];
  canManage: boolean;
}) {
  if (capabilities.length === 0) return null;

  const live = capabilities.filter((c) => c.enabled);
  const review = capabilities.filter((c) => !c.enabled && c.risk !== "destructive");
  const off = capabilities.filter((c) => !c.enabled && c.risk === "destructive");

  return (
    <section className="enter-up mt-10">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">
          Capabilities
        </h2>
        <p className="text-[12px] text-ink-subtle">
          Detected from the code when this app was deployed
        </p>
      </div>

      <div className="mt-3 flex flex-col gap-4">
        <Group
          title="Enabled"
          note="Agents can find and run these."
          items={live}
          canManage={canManage}
        />
        <Group
          title="Review"
          note="Registered, but off until someone turns them on."
          items={review}
          canManage={canManage}
        />
        <Group
          title="Disabled"
          note="Cannot be undone once run, so these stay off."
          items={off}
          canManage={canManage}
        />
      </div>
    </section>
  );
}

function Group({
  title,
  note,
  items,
  canManage,
}: {
  title: string;
  note: string;
  items: Capability[];
  canManage: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <div>
      <div className="flex items-baseline gap-2.5">
        <p className="eyebrow">{title}</p>
        <p className="text-[11px] text-ink-subtle">{note}</p>
      </div>

      <ul className="mt-2 divide-y divide-line overflow-hidden rounded-[var(--radius-edge)] border border-line bg-surface">
        {items.map((capability) => (
          <Row key={capability.id} capability={capability} canManage={canManage} />
        ))}
      </ul>
    </div>
  );
}

function Row({ capability, canManage }: { capability: Capability; canManage: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = () => {
    setError(null);
    startTransition(async () => {
      const result = await setCapabilityEnabled(capability.id, !capability.enabled);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  };

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 transition-colors duration-150 hover:bg-sunken/40">
      <RiskMark risk={capability.risk} />

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[12.5px] font-medium text-ink">
            {capability.name}
          </span>
          <span className="eyebrow">
            {capability.target.method} {capability.target.path}
          </span>
        </span>
        <span className="mt-0.5 block text-[12px] text-ink-muted">
          {capability.description}
        </span>
        {error !== null ? (
          <span role="alert" className="enter-fade mt-1 block text-[11.5px] text-failed">
            {error}
          </span>
        ) : null}
      </span>

      {canManage ? (
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          className="btn btn-secondary shrink-0 px-2.5 py-1.5 text-[12px]"
        >
          {pending ? "Saving..." : capability.enabled ? "Disable" : "Enable"}
        </button>
      ) : null}
    </li>
  );
}

/**
 * Risk as a shape, not only a word.
 *
 * Read is the common case and gets the quietest mark; the two that change
 * something get colour, because that is the distinction someone scanning this
 * list actually needs.
 */
function RiskMark({ risk }: { risk: Capability["risk"] }) {
  const style =
    risk === "read"
      ? "border-line bg-sunken text-ink-subtle"
      : risk === "write"
        ? "border-pending/40 bg-pending/10 text-pending"
        : "border-failed/40 bg-failed/10 text-failed";

  return (
    <span
      title={`${risk} capability`}
      className={`inline-flex shrink-0 items-center rounded-[var(--radius-edge)] border px-1.5 py-[3px] text-[10px] font-semibold tracking-[0.06em] uppercase ${style}`}
    >
      {risk}
    </span>
  );
}
