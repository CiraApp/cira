"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { renameSpace, setJoinByDomain } from "@/lib/space-actions";

/**
 * The two things about a space an admin changes: what it is called, and
 * whether a company address is enough to get in.
 */
export function SpaceSettingsForm({
  spaceSlug,
  name,
  domain,
  joinByDomain,
}: {
  spaceSlug: string;
  name: string;
  domain: string | null;
  joinByDomain: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const run = (label: string, work: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    setSaved(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        setError(result.error ?? "That did not work.");
        return;
      }
      setSaved(label);
      router.refresh();
    });
  };

  return (
    <section className="mt-8">
      <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">Change</h2>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          run("Name saved.", () => renameSpace(spaceSlug, draft));
        }}
        className="mt-3 flex flex-wrap items-end gap-2"
      >
        <label className="flex min-w-[240px] flex-1 flex-col gap-1.5 text-[12px] text-ink-subtle">
          Space name
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={60}
            className="field py-2.5 text-[13.5px]"
          />
        </label>
        <button
          type="submit"
          disabled={pending || draft.trim() === name}
          className="btn btn-secondary"
        >
          Rename
        </button>
      </form>
      <p className="mt-1.5 text-[11.5px] text-ink-subtle">
        The address stays /{spaceSlug}, so links, linked folders and assistants keep
        working.
      </p>

      {domain !== null ? (
        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-[var(--radius-edge)] border border-line bg-surface px-4 py-3.5 transition-colors duration-150 hover:bg-sunken/40">
          <input
            type="checkbox"
            checked={joinByDomain}
            disabled={pending}
            onChange={() =>
              run(
                joinByDomain ? "Joining by address is off." : "Joining by address is on.",
                () => setJoinByDomain(spaceSlug, !joinByDomain),
              )
            }
            className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-accent)]"
          />
          <span>
            <span className="block text-[13px] text-ink">
              Let anyone with a verified @{domain} address join
            </span>
            <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-subtle">
              They join as members, see only the apps shared with everyone, and count as a
              seat. Off means people come in by invite only. Someone you remove cannot
              come back this way.
            </span>
          </span>
        </label>
      ) : null}

      {error !== null ? (
        <p role="alert" className="mt-3 text-[12.5px] text-failed">
          {error}
        </p>
      ) : saved !== null ? (
        <p role="status" className="enter-fade mt-3 text-[12.5px] text-ink-muted">
          {saved}
        </p>
      ) : null}
    </section>
  );
}
