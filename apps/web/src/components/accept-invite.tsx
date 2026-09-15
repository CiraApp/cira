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
        className="btn btn-primary btn-lg"
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
