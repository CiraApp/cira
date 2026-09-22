"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@cira/core";
import { changeRole, leaveSpace, removeMember } from "@/lib/member-actions";
import { Dialog } from "./ui/dialog";

const ROLE_NOTE: Record<Role, string> = {
  owner: "Full control of this space",
  admin: "Can manage apps and people",
  member: "Can use the apps they are given",
};

const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

/**
 * The right-hand side of one person's row on the members page: what they
 * are, and - for whoever may change it - the means to change it.
 *
 * The rules live in core (`checkRoleChange`, `checkRemoval`) and are enforced
 * on the server; this only avoids offering what would be refused, so nobody
 * is shown an Owner option they cannot pick or a Remove button that fails.
 */
export function MemberControls({
  spaceSlug,
  spaceName,
  person,
  viewer,
  ownedApps,
  heirName,
}: {
  spaceSlug: string;
  spaceName: string;
  person: { userId: string; name: string; role: Role };
  viewer: { userId: string; name: string; role: Role };
  /** How many apps this person owns here, which change hands if they go. */
  ownedApps: number;
  /** Who would take this person's apps if they left of their own accord. */
  heirName: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const self = person.userId === viewer.userId;
  const viewerIsAdmin = viewer.role === "admin" || viewer.role === "owner";
  // An admin looks after members and admins; only an owner touches an owner.
  const canChange =
    viewerIsAdmin && (person.role !== "owner" || viewer.role === "owner") && !self;
  const choices: Role[] =
    viewer.role === "owner" ? ["member", "admin", "owner"] : ["member", "admin"];

  const run = (
    work: () => Promise<{ ok: boolean; error?: string }>,
    after?: () => void,
  ) => {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        setError(result.error ?? "That did not work.");
        return;
      }
      setConfirming(false);
      after?.();
      router.refresh();
    });
  };

  const apps = `${ownedApps} ${ownedApps === 1 ? "app" : "apps"}`;

  return (
    <span className="flex shrink-0 flex-col items-end gap-1">
      <span className="flex items-center gap-2">
        {canChange ? (
          <>
            <label htmlFor={`role-${person.userId}`} className="sr-only">
              {person.name}&rsquo;s role
            </label>
            <select
              id={`role-${person.userId}`}
              value={person.role}
              disabled={pending}
              onChange={(e) => {
                const role = e.target.value as Role;
                run(() => changeRole(spaceSlug, person.userId, role));
              }}
              title={ROLE_NOTE[person.role]}
              className="field w-auto py-1.5 pr-7 text-[12.5px]"
            >
              {choices.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirming(true)}
              className="btn btn-ghost px-2.5 py-1.5 text-[12.5px] hover:text-failed"
            >
              Remove
            </button>
          </>
        ) : (
          <span className="hidden text-right sm:block">
            <span className="block text-[12px] font-medium text-ink">
              {ROLE_LABEL[person.role]}
            </span>
            <span className="block text-[11px] text-ink-subtle">
              {ROLE_NOTE[person.role]}
            </span>
          </span>
        )}

        {self ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirming(true)}
            className="btn btn-ghost px-2.5 py-1.5 text-[12.5px] hover:text-failed"
          >
            Leave
          </button>
        ) : null}
      </span>

      {error !== null && !confirming ? (
        <span
          role="alert"
          className="enter-fade max-w-[280px] text-right text-[12px] text-failed"
        >
          {error}
        </span>
      ) : null}

      <Dialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
          setError(null);
        }}
        title={self ? `Leave ${spaceName}?` : `Remove ${person.name} from ${spaceName}?`}
        description={
          self ? (
            <>
              You lose access to every app here straight away, including from the CLI and
              any assistant you connected.
              {ownedApps > 0 && heirName !== null
                ? ` Your ${apps} ${ownedApps === 1 ? "goes" : "go"} to ${heirName}, who can hand ${ownedApps === 1 ? "it" : "them"} on.`
                : ""}{" "}
              An admin can invite you back.
            </>
          ) : (
            <>
              {person.name} loses access to every app here straight away, including from
              the CLI and any assistant they connected.
              {ownedApps > 0
                ? ` Their ${apps} ${ownedApps === 1 ? "becomes" : "become"} yours.`
                : ""}{" "}
              Only an invite brings them back.
            </>
          )
        }
      >
        {error !== null ? (
          <p role="alert" className="mb-3 text-[12.5px] text-failed">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-dialog-close
            onClick={() => setConfirming(false)}
            className="btn btn-ghost"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              self
                ? run(
                    () => leaveSpace(spaceSlug),
                    () => router.push("/"),
                  )
                : run(() => removeMember(spaceSlug, person.userId))
            }
            className="btn btn-danger"
          >
            {pending
              ? self
                ? "Leaving..."
                : "Removing..."
              : self
                ? "Leave"
                : `Remove ${person.name}`}
          </button>
        </div>
      </Dialog>
    </span>
  );
}
