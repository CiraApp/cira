"use client";

import { LiveStatus } from "./ui/live-status";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { renameSpace, setJoinByDomain, setSpaceLogo } from "@/lib/space-actions";
import { squarePicture } from "@/lib/square-picture";
import { SpaceIcon } from "./space-icon";

/**
 * The things about a space an admin changes: how it looks, what it is called,
 * and whether a company address is enough to get in.
 */
export function SpaceSettingsForm({
  spaceSlug,
  name,
  image,
  domain,
  joinByDomain,
}: {
  spaceSlug: string;
  name: string;
  image: string | null;
  domain: string | null;
  joinByDomain: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // Which control the message is about, so it is said beside that control
  // rather than at the foot of the section, a screen away from the logo.
  const [about, setAbout] = useState<"logo" | "rest">("rest");
  const picker = useRef<HTMLInputElement>(null);

  const pick = () => {
    if (!pending) picker.current?.click();
  };

  const run = (
    label: string,
    work: () => Promise<{ ok: boolean; error?: string }>,
    place: "logo" | "rest" = "rest",
  ) => {
    if (pending) return;
    setAbout(place);
    setError(null);
    setSaved(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        setError(result.error ?? "That did not work.");
        return;
      }
      setSaved(label);
      router.refresh();
    });
  };

  return (
    <section className="mt-8">
      <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">Change</h2>

      <div className="mt-3 flex items-center gap-4">
        {/* The logo is changed by clicking the logo, as an app's picture is. */}
        <button
          type="button"
          onClick={pick}
          aria-disabled={pending || undefined}
          aria-label={image === null ? "Add a logo" : "Change the logo"}
          title={image === null ? "Add a logo" : "Change the logo"}
          className="shrink-0 rounded-[var(--radius-edge)] transition-opacity duration-150 hover:opacity-85 aria-disabled:opacity-60"
        >
          <SpaceIcon name={name} image={image} size="lg" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] text-ink-subtle">Logo</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={pick}
              aria-disabled={pending || undefined}
              className="btn btn-secondary"
            >
              {image === null ? "Upload a logo" : "Change logo"}
            </button>
            {image !== null ? (
              <button
                type="button"
                onClick={() =>
                  run("Logo removed.", () => setSpaceLogo(spaceSlug, ""), "logo")
                }
                aria-disabled={pending || undefined}
                className="btn btn-ghost"
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
        <input
          ref={picker}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Cleared so picking the same file twice still counts as a change.
            event.target.value = "";
            if (file === undefined) return;
            setAbout("logo");
            setError(null);
            setSaved(null);
            squarePicture(file).then(
              (picture) =>
                run("Logo saved.", () => setSpaceLogo(spaceSlug, picture), "logo"),
              (reason: Error) => setError(reason.message),
            );
          }}
        />
      </div>
      <p className="mt-2 text-[11.5px] text-ink-subtle">
        A PNG, JPEG or WebP, cropped to a square. Everyone in the space sees it beside the
        name, and so does anyone opening an invitation.
      </p>
      {about === "logo" ? <Outcome error={error} saved={saved} /> : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim() === name) return;
          run("Name saved.", () => renameSpace(spaceSlug, draft));
        }}
        className="mt-5 flex flex-wrap items-end gap-2"
      >
        <label className="flex min-w-[240px] flex-1 flex-col gap-1.5 text-[12px] text-ink-subtle">
          Space name
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={60}
            className="field py-2.5 text-[13.5px]"
          />
        </label>
        <button
          type="submit"
          // Not disabled: once the rename lands the name matches the draft,
          // and a disabled button would drop focus to the top of the page.
          aria-disabled={pending || draft.trim() === name || undefined}
          className="btn btn-secondary"
        >
          Rename
        </button>
      </form>
      <p className="mt-1.5 text-[11.5px] text-ink-subtle">
        The address stays /{spaceSlug}, so links, linked folders and assistants keep
        working.
      </p>

      {domain !== null ? (
        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-[var(--radius-edge)] border border-line bg-surface px-4 py-3.5 transition-colors duration-150 hover:bg-sunken/40">
          <input
            type="checkbox"
            checked={joinByDomain}
            aria-disabled={pending || undefined}
            onChange={() =>
              run(
                joinByDomain ? "Joining by address is off." : "Joining by address is on.",
                () => setJoinByDomain(spaceSlug, !joinByDomain),
              )
            }
            className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-accent)]"
          />
          <span>
            <span className="block text-[13px] text-ink">
              Let anyone with a verified @{domain} address join
            </span>
            <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-subtle">
              They join as members, see only the apps shared with everyone, and count as a
              seat. Off means people come in by invite only. Someone you remove cannot
              come back this way.
            </span>
          </span>
        </label>
      ) : null}

      {about === "rest" ? <Outcome error={error} saved={saved} /> : null}
      {/* One region for the whole section, mounted throughout, or a message
          arriving with a freshly mounted region is not announced. */}
      <LiveStatus message={error === null ? saved : null} />
    </section>
  );
}

/** What became of the last change, shown where it was made. */
function Outcome({ error, saved }: { error: string | null; saved: string | null }) {
  if (error !== null) {
    return (
      <p role="alert" className="mt-3 text-[12.5px] text-failed">
        {error}
      </p>
    );
  }
  if (saved !== null) {
    return (
      <p aria-hidden="true" className="enter-fade mt-3 text-[12.5px] text-ink-muted">
        {saved}
      </p>
    );
  }
  return null;
}
