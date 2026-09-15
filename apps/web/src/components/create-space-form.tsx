"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSpace, type ActionResult } from "@/lib/actions";

export function CreateSpaceForm() {
  const router = useRouter();
  const [state, action, pending] = useActionState<
    ActionResult<{ slug: string }> | null,
    FormData
  >(createSpace, null);

  useEffect(() => {
    if (state?.ok === true) router.push(`/${state.data.slug}`);
  }, [state, router]);

  return (
    <form action={action} className="flex flex-col gap-3">
      <label htmlFor="name" className="text-sm font-medium text-ink">
        Company or team name
      </label>

      <input
        id="name"
        name="name"
        type="text"
        required
        autoFocus
        autoComplete="organization"
        placeholder="Acme"
        aria-describedby={state?.ok === false ? "name-error" : undefined}
        className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-[15px] text-ink shadow-xs outline-none placeholder:text-ink-subtle focus:border-accent"
      />

      {state?.ok === false ? (
        <p id="name-error" role="alert" className="text-sm text-failed">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 w-full rounded-xl bg-accent px-4 py-3 text-[15px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
      >
        {pending ? "Creating..." : "Create space"}
      </button>
    </form>
  );
}
