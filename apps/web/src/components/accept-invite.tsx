"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptInvite } from "@/lib/invite-actions";
import { NameForm } from "@/components/name-form";

/**
 * Joining a space from an invite.
 *
 * Someone invited has usually never used Cira, and signing in by email code
 * tells Cira nothing about them but the address. Joining without a name made
 * them their email address everywhere their colleagues look - twice on the
 * members page, once as the name and once as the address. So a person Cira
 * has no name for gives one here, and joining is the same click.
 */
export function AcceptInvite({
  token,
  spaceName,
  needsName,
}: {
  token: string;
  spaceName: string;
  needsName: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const accept = useCallback(() => {
    setError(null);
    startTransition(async () => {
      const result = await acceptInvite(token);
      if (result.ok) {
        router.push(`/${result.spaceSlug}`);
      } else {
        setError(result.error);
      }
    });
  }, [token, router]);

  return (
    <div className="flex flex-col gap-3">
      {needsName ? (
        <NameForm
          firstName={null}
          lastName={null}
          submitLabel={pending ? "Joining..." : `Join ${spaceName}`}
          onSaved={accept}
        />
      ) : (
        <button
          type="button"
          onClick={accept}
          disabled={pending}
          className="btn btn-primary btn-lg"
        >
          {pending ? "Joining..." : `Join ${spaceName}`}
        </button>
      )}

      {error !== null ? (
        <p role="alert" className="text-[13px] text-failed">
          {error}
        </p>
      ) : null}
    </div>
  );
}
