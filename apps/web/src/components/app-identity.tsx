"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateAppDetails } from "@/lib/app-settings-actions";

/**
 * An app's name and description, editable where they are read.
 *
 * Both were already editable, at the bottom of the page inside a collapsed
 * disclosure next to Delete. That is the right place for the settings nobody
 * touches and the wrong place for the two that are simply wrong sometimes -
 * a generated description, a name that was the folder's rather than the
 * product's. Fixing those should not feel like going into settings.
 *
 * So the text becomes the field, and looks like the text the whole time. No
 * filled boxes, no heavy borders, nothing that reads as a form dropped into
 * the page - just a hairline saying the words can be typed in, and the app's
 * own colour picking it out once they are. Nothing moves when editing starts,
 * because the inputs sit exactly where the text sat.
 */
export function AppIdentity({
  spaceSlug,
  appSlug,
  name,
  description,
  canManage,
}: {
  spaceSlug: string;
  appSlug: string;
  name: string;
  description: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draftName, setDraftName] = useState(name);
  const [draftDescription, setDraftDescription] = useState(description ?? "");
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) field.current?.focus();
  }, [editing]);

  const stop = () => {
    setEditing(false);
    setError(null);
    setDraftName(name);
    setDraftDescription(description ?? "");
  };

  const save = () => {
    if (draftName.trim() === name && draftDescription.trim() === (description ?? "")) {
      stop();
      return;
    }

    setError(null);
    startTransition(async () => {
      const form = new FormData();
      form.set("name", draftName);
      form.set("description", draftDescription);
      // Deliberately not sending the homepage. It is not shown here, and a
      // form that clears what it never displayed is a form that loses data.
      const result = await updateAppDetails(spaceSlug, appSlug, form);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setEditing(false);
      // The slug moves with the name, so the address this page is at may no
      // longer exist.
      router.replace(`/${spaceSlug}/${result.data.appSlug}`);
      router.refresh();
    });
  };

  if (!editing) {
    return (
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.02em] text-ink">
            {name}
          </h1>
          {description !== null && description !== "" ? (
            <p className="mt-1 text-[13.5px] text-ink-muted">{description}</p>
          ) : null}
        </div>

        {canManage ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="Rename this app"
            title="Rename this app"
            className="-mt-1 shrink-0 rounded-[var(--radius-edge)] border border-transparent p-1.5 text-ink-subtle transition-colors duration-150 hover:border-line hover:bg-sunken hover:text-ink"
          >
            <Pencil />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="min-w-0 flex-1">
      <input
        ref={field}
        value={draftName}
        onChange={(event) => setDraftName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") save();
          if (event.key === "Escape") stop();
        }}
        aria-label="App name"
        maxLength={60}
        // Sized and weighted like the heading it replaces, and negatively
        // margined so the text sits on the same pixel it did when it was a
        // heading. The hairline is the only thing that appears.
        className="-mx-2 w-[calc(100%+1rem)] rounded-[var(--radius-edge)] border border-line/70 bg-transparent px-2 py-0.5 text-[22px] leading-tight font-semibold tracking-[-0.02em] text-ink transition-colors duration-150 outline-none focus:border-[rgb(var(--glow)/0.5)]"
      />

      <textarea
        value={draftDescription}
        onChange={(event) => setDraftDescription(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") stop();
        }}
        aria-label="App description"
        rows={2}
        maxLength={140}
        placeholder="What this app is for."
        className="-mx-2 mt-1 w-[calc(100%+1rem)] resize-none rounded-[var(--radius-edge)] border border-line/70 bg-transparent px-2 py-1 text-[13.5px] text-ink-muted transition-colors duration-150 outline-none focus:border-[rgb(var(--glow)/0.5)]"
      />

      {error !== null ? (
        <p role="alert" className="enter-fade mt-1.5 text-[11.5px] text-failed">
          {error}
        </p>
      ) : null}

      {/*
        One quiet line rather than a button bar. Enter and Escape are the way
        out for anyone typing, which is everyone here; these are for saying so,
        and for the pointer.
      */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="font-medium text-ink transition-opacity duration-150 hover:opacity-70 disabled:opacity-50"
        >
          {pending ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={stop}
          disabled={pending}
          className="text-ink-muted transition-colors duration-150 hover:text-ink"
        >
          Cancel
        </button>
        <span className="text-ink-subtle">
          Renaming changes the address, so existing links will stop working.
        </span>
      </div>
    </div>
  );
}

function Pencil() {
  return (
    <svg
      viewBox="0 0 14 14"
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.2 2.4l2.4 2.4M2.5 9.1l6.7-6.7 2.4 2.4-6.7 6.7-3 .6z" />
    </svg>
  );
}
