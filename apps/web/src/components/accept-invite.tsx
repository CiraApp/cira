"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptInvite } from "@/lib/invite-actions";

export function AcceptInvite({ token, spaceName }: { token: string; spaceName: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const accept = () => {
    setError(null);
    startTransition(async () => {
      const result = await acceptInvite(token);
      if (result.ok) {
        router.push(`/${result.spaceSlug}`);
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={accept}
        disabled={pending}
        className="rounded-xl bg-accent px-5 py-2.5 text-[15px] font-medium text-white shadow-[0_6px_18px_-6px_color-mix(in_oklab,var(--color-accent)_70%,transparent)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-accent-hover disabled:translate-y-0 disabled:opacity-60"
      >
        {pending ? "Joining..." : `Join ${spaceName}`}
      </button>

      {error !== null ? (
        <p role="alert" className="text-[13px] text-failed">
          {error}
        </p>
      ) : null}
    </div>
  );
}
