"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateAppDetails, updateAppImage } from "@/lib/app-settings-actions";
import { squarePicture } from "@/lib/square-picture";
import { AppIcon } from "./app-icon";

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
  appId,
  name,
  description,
  icon,
  image,
  canManage,
  children,
}: {
  spaceSlug: string;
  appSlug: string;
  appId: string;
  name: string;
  description: string | null;
  icon: string | null;
  image: string | null;
  canManage: boolean;
  /** The status line, which sits under the name in both states. */
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draftName, setDraftName] = useState(name);
  const [draftDescription, setDraftDescription] = useState(description ?? "");
  const field = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const blurb = useRef<HTMLTextAreaElement>(null);

  // Grown to its content whenever that changes, and once on opening so it
  // starts at the right height rather than settling into it.
  useEffect(() => {
    const element = blurb.current;
    if (element === null) return;

    element.style.height = "auto";
    // Plus the border, which `scrollHeight` does not count and `height` does.
    // Without it the box lands two pixels short and clips its own last line,
    // which looks like nothing at all until a description runs to two.
    const edges = window.getComputedStyle(element);
    const border = parseFloat(edges.borderTopWidth) + parseFloat(edges.borderBottomWidth);
    element.style.height = `${element.scrollHeight + border}px`;
  }, [draftDescription, editing]);

  const choose = (file: File | undefined) => {
    if (file === undefined) return;
    setError(null);
    squarePicture(file).then(storeImage, (reason: Error) => setError(reason.message));
  };

  const storeImage = (picture: string) => {
    if (pending) return;
    startTransition(async () => {
      const result = await updateAppImage(spaceSlug, appSlug, picture);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  };

  // Back to the pencil when editing ends, however it ends: the fields that
  // had focus are gone, and focus must not go with them.
  const pencil = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing) field.current?.focus();
    else if (wasEditing.current) pencil.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  const stop = () => {
    if (pending) return;
    setEditing(false);
    setError(null);
    setDraftName(name);
    setDraftDescription(description ?? "");
  };

  const save = () => {
    if (pending) return;
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

  const face = <AppIcon appId={appId} name={name} icon={icon} image={image} size="lg" />;

  if (!editing) {
    return (
      <div className="flex min-w-0 flex-1 items-start gap-4">
        {face}
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.02em] text-ink">
            {name}
          </h1>
          {description !== null && description !== "" ? (
            <p className="mt-1 text-[13.5px] text-ink-muted">{description}</p>
          ) : null}
          {children}
        </div>

        {canManage ? (
          <button
            ref={pencil}
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
    <div className="flex min-w-0 flex-1 items-start gap-4">
      {/*
        The picture is changed by clicking the picture. Not a second copy of it
        beside the first - that only asked which of the two squares was the
        real one. This is the app's own face with an invitation laid over it,
        and only while editing, because a face is not a button the rest of the
        time.
      */}
      <button
        type="button"
        onClick={() => {
          if (!pending) picker.current?.click();
        }}
        aria-disabled={pending || undefined}
        className="group relative shrink-0 rounded-[5px]"
        aria-label={image === null ? "Add a picture" : "Change the picture"}
        title={image === null ? "Add a picture" : "Change the picture"}
      >
        {face}
        <span className="absolute inset-0 flex items-center justify-center rounded-[5px] bg-black/60 text-white/90 opacity-80 transition-opacity duration-150 group-hover:opacity-100">
          <Photo />
        </span>
      </button>

      <input
        ref={picker}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          choose(event.target.files?.[0]);
          // Cleared so picking the same file twice still counts as a change.
          event.target.value = "";
        }}
      />

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
          ref={blurb}
          rows={1}
          maxLength={140}
          placeholder="What this app is for."
          // One row, grown to whatever is in it. A fixed two rows left a box
          // standing well below its own text, which read as an empty field
          // rather than as the sentence it already contains.
          className="-mx-2 mt-1 w-[calc(100%+1rem)] resize-none overflow-hidden rounded-[var(--radius-edge)] border border-line/70 bg-transparent px-2 py-1 text-[13.5px] leading-snug text-ink-muted transition-colors duration-150 outline-none focus:border-[rgb(var(--glow)/0.5)]"
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
            aria-disabled={pending || undefined}
            className="font-medium text-ink transition-opacity duration-150 hover:opacity-70 aria-disabled:opacity-50"
          >
            {pending ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={stop}
            aria-disabled={pending || undefined}
            className="text-ink-muted transition-colors duration-150 hover:text-ink"
          >
            Cancel
          </button>
          {image !== null ? (
            <button
              type="button"
              onClick={() => storeImage("")}
              aria-disabled={pending || undefined}
              className="text-ink-muted transition-colors duration-150 hover:text-ink"
            >
              Remove picture
            </button>
          ) : null}
          <span className="text-ink-subtle">
            Renaming changes the address. Old links keep working.
          </span>
        </div>

        {children}
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

/** The invitation laid over an app's face while it is being edited. */
function Photo() {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2.5" y="4" width="15" height="12" rx="1.5" />
      <circle cx="7" cy="8.5" r="1.4" />
      <path d="M2.5 13.2l4-3.4 4.2 3.6 2.6-2.2 4.2 3.4" />
    </svg>
  );
}
