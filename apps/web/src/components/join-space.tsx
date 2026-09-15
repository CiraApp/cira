"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Space } from "@cira/core";
import { joinSpaceByDomain } from "@/lib/join-actions";

/**
 * Offered to someone whose company already has a space. Joining is one click
 * and the obvious action; founding a second copy of your own workplace should
 * take more effort than joining it.
 */
export function JoinSpace({ spaces, domain }: { spaces: Space[]; domain: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState<string | null>(null);

  const join = (slug: string) => {
    setError(null);
    setJoining(slug);
    startTransition(async () => {
      const result = await joinSpaceByDomain(slug);
      if (result.ok) {
        router.push(`/${result.spaceSlug}`);
      } else {
        setError(result.error);
        setJoining(null);
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {spaces.map((space) => (
        <button
          key={space.id}
          type="button"
          onClick={() => join(space.slug)}
          disabled={pending}
          className="group flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface px-5 py-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)] disabled:translate-y-0 disabled:opacity-60"
        >
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-medium text-ink">
              {space.name}
            </span>
            <span className="block truncate text-[13px] text-ink-muted">
              Everyone at {domain}
            </span>
          </span>

          <span className="shrink-0 text-[14px] font-medium text-accent">
            {joining === space.slug ? "Joining..." : "Join"}
          </span>
        </button>
      ))}

      {error !== null ? (
        <p role="alert" className="text-[13px] text-failed">
          {error}
        </p>
      ) : null}
    </div>
  );
}
