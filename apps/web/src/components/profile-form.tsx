"use client";

import { LiveStatus } from "./ui/live-status";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { NameForm } from "./name-form";

/** The name form, and a word to say it took. */
export function ProfileForm({
  firstName,
  lastName,
}: {
  firstName: string | null;
  lastName: string | null;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);

  // A refresh, so the header, the home greeting and anywhere else your name
  // appears pick it up without a reload.
  const onSaved = useCallback(() => {
    setSaved(true);
    router.refresh();
  }, [router]);

  return (
    <div className="relative">
      <NameForm
        firstName={firstName}
        lastName={lastName}
        submitLabel="Save"
        size="md"
        onSaved={onSaved}
      />
      {saved ? (
        <p
          aria-hidden="true"
          className="enter-fade absolute right-0 bottom-2 text-[12.5px] text-ink-muted"
        >
          Saved
        </p>
      ) : null}
      <LiveStatus message={saved ? "Saved" : null} />
    </div>
  );
}
