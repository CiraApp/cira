"use client";

import { useActionState, useEffect, useRef } from "react";
import { updateProfile, type ProfileResult } from "@/lib/profile-actions";

/**
 * First and last name, side by side.
 *
 * One form for both places a name is given - the first step of onboarding and
 * the profile page - so the two can never disagree about what a name is. Two
 * fields rather than one, because the greeting needs the first name on its
 * own, and splitting a full name on its first space is wrong for plenty of
 * real people.
 */
export function NameForm({
  firstName,
  lastName,
  submitLabel,
  size = "lg",
  onSaved,
}: {
  firstName: string | null;
  lastName: string | null;
  submitLabel: string;
  /** `lg` for onboarding's single card, `md` inside the settings layout. */
  size?: "md" | "lg";
  onSaved?: (firstName: string) => void;
}) {
  const [state, action, pending] = useActionState<ProfileResult | null, FormData>(
    updateProfile,
    null,
  );

  // Once per save, not once per render that happens to still hold the result.
  const reported = useRef<ProfileResult | null>(null);
  useEffect(() => {
    if (state?.ok === true && reported.current !== state) {
      reported.current = state;
      onSaved?.(state.firstName);
    }
  }, [state, onSaved]);

  const field = size === "lg" ? "field py-3 text-[15px]" : "field py-2.5 text-[14px]";

  return (
    <form action={action} className="flex flex-col">
      <div className="grid grid-cols-2 gap-2.5">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[12px] text-ink-subtle">First name</span>
          <input
            name="firstName"
            type="text"
            required
            autoFocus={size === "lg"}
            autoComplete="given-name"
            spellCheck={false}
            maxLength={60}
            defaultValue={firstName ?? ""}
            aria-describedby={state?.ok === false ? "name-error" : undefined}
            className={field}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[12px] text-ink-subtle">
            Last name <span className="text-ink-subtle/70">(optional)</span>
          </span>
          <input
            name="lastName"
            type="text"
            autoComplete="family-name"
            spellCheck={false}
            maxLength={60}
            defaultValue={lastName ?? ""}
            className={field}
          />
        </label>
      </div>

      {state?.ok === false ? (
        <p
          id="name-error"
          role="alert"
          className="enter-fade mt-2.5 text-[12.5px] text-failed"
        >
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className={`btn btn-primary mt-4 ${size === "lg" ? "btn-lg w-full" : "self-start"}`}
      >
        {pending ? "Saving..." : submitLabel}
      </button>
    </form>
  );
}
