"use client";

import { LiveStatus } from "./ui/live-status";
import { Switch } from "./ui/switch";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { describeMemory } from "@cira/core/processes";
import {
  deleteApp,
  setAppMemory,
  setKeepWarm,
  setTellsWhoIsCalling,
  updateAppDetails,
} from "@/lib/app-settings-actions";

/**
 * Settings sit behind a disclosure because they are rare and one of them is
 * destructive. Nothing here should be a thing you click on the way past.
 *
 * The name and description used to live here and now live at the top of the
 * page, where they are read - which is where somebody notices they are wrong.
 * Leaving a copy behind would have been two forms for one field, able to
 * disagree about what is in it.
 */
export function AppSettings({
  spaceSlug,
  appSlug,
  appName,
  appHomepageUrl,
  keepWarm,
  canKeepWarm,
  warmMonthly,
  tellsWhoIsCalling,
  canTellWhoIsCalling,
  memory,
}: {
  spaceSlug: string;
  appSlug: string;
  /** Only for the delete confirmation; renaming happens at the top of the page. */
  appName: string;
  appHomepageUrl: string | null;
  /** Whether an instance is being kept running for it. */
  keepWarm: boolean | null;
  /** False on a plan that does not include it, so the switch explains itself. */
  canKeepWarm: boolean;
  warmMonthly: number;
  /** Whether Cira tells this app who is calling. */
  tellsWhoIsCalling: boolean;
  /** False when this Cira has no signing key, so the switch explains itself. */
  canTellWhoIsCalling: boolean;
  /** The web service's memory, per container. Null for an app with no web service. */
  memory: {
    current: number;
    /** What it runs with when nobody has chosen: the repository's size, or the default. */
    fallback: number;
    chosen: number | null;
    declared: number | null;
    choices: readonly number[];
  } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [warm, setWarm] = useState(keepWarm === true);
  const [tells, setTells] = useState(tellsWhoIsCalling);
  const [confirmName, setConfirmName] = useState("");
  const [confirming, setConfirming] = useState(false);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const [saved, setSaved] = useState(false);
  const panel = useRef<HTMLDetailsElement>(null);

  // Opened by a link from elsewhere on the page, because the one setting here
  // that someone arrives looking for - where this app really opens - is the
  // one they are sent to rather than the one they go hunting for.
  //
  // On the hash changing as well as on mount. The link is on this same page,
  // so following it never remounts anything: checking only once would leave
  // the panel shut for exactly the person who was sent here to open it.
  useEffect(() => {
    const reveal = () => {
      if (window.location.hash !== "#settings") return;
      const element = panel.current;
      if (element === null) return;
      element.open = true;

      // To the field itself, not to the panel that contains it. Opening the
      // panel puts its heading at the top of the screen and leaves Homepage
      // below the fold under Name and Description - which is the same hunt the
      // link existed to save. Focused as well as scrolled to, so the cursor is
      // already where the answer goes.
      const field = element.querySelector<HTMLInputElement>("#app-homepage");
      const target = field ?? element;
      // Smooth only for someone who has not asked for less motion: the CSS
      // that honours that preference does not reach a scroll started here.
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
      field?.focus({ preventScroll: true });
    };

    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, []);

  const save = (formData: FormData) => {
    if (pending) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateAppDetails(spaceSlug, appSlug, formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  };

  const remove = () => {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteApp(spaceSlug, appSlug, confirmName);
      if (result.ok) router.replace(`/${spaceSlug}`);
      else setError(result.error);
    });
  };

  return (
    <details id="settings" ref={panel} className="group mt-10 scroll-mt-6">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-[12.5px] text-ink-muted transition-colors duration-150 hover:text-ink">
        <svg
          viewBox="0 0 12 12"
          aria-hidden="true"
          className="h-3 w-3 transition-transform duration-300 ease-[var(--ease-spring)] group-open:rotate-90"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m4.5 2.5 3.5 3.5-3.5 3.5" />
        </svg>
        Settings
      </summary>

      <div className="enter-up mt-4 flex flex-col gap-6 rounded-[var(--radius-edge)] border border-line bg-surface p-5">
        <form action={save} className="flex flex-col gap-2">
          <label htmlFor="app-homepage" className="text-[12.5px] font-medium text-ink">
            Homepage
          </label>
          <p
            id="app-homepage-note"
            className="text-[11.5px] leading-relaxed text-ink-subtle"
          >
            Where Open should send people, if the interface they use lives somewhere Cira
            does not host. Empty means Cira opens the app it serves.
          </p>
          <input
            id="app-homepage"
            aria-describedby="app-homepage-note"
            name="homepageUrl"
            type="url"
            inputMode="url"
            defaultValue={appHomepageUrl ?? ""}
            placeholder="https://tools.example.com"
            className="field mt-1"
          />

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="submit"
              aria-disabled={pending || undefined}
              className="btn btn-secondary"
            >
              {pending ? "Saving..." : "Save"}
            </button>
            {saved && !pending ? (
              <span aria-hidden="true" className="enter-fade text-[11.5px] text-live">
                Saved
              </span>
            ) : null}
            <LiveStatus message={saved && !pending ? "Homepage saved" : null} />
          </div>
        </form>

        {memory !== null ? (
          <div className="border-t border-line pt-5">
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
              <div className="min-w-0 flex-1">
                <label
                  htmlFor="app-memory"
                  className="text-[12.5px] font-medium text-ink"
                >
                  Memory
                </label>
                <p
                  id="app-memory-note"
                  className="mt-1 text-[11.5px] leading-relaxed text-ink-subtle"
                >
                  What each instance of the app runs with.{" "}
                  {memory.chosen !== null
                    ? "Chosen here, over what the repository says."
                    : memory.declared !== null
                      ? "As its repository asks."
                      : "Cira's default."}{" "}
                  An app that runs out is restarted, so a server that renders pages or
                  holds large files may need more. Changing it starts a new instance.
                </p>
              </div>
              <select
                id="app-memory"
                aria-describedby="app-memory-note"
                value={memory.chosen === null ? "" : String(memory.chosen)}
                // Busy rather than disabled, which would drop focus mid-change.
                aria-disabled={pending || undefined}
                onChange={(e) => {
                  if (pending) return;
                  const value = e.target.value === "" ? null : Number(e.target.value);
                  setError(null);
                  startTransition(async () => {
                    const result = await setAppMemory(spaceSlug, appSlug, value);
                    if (result.ok) router.refresh();
                    else setError(result.error);
                  });
                }}
                className="field w-auto shrink-0 py-1.5 text-[12.5px]"
              >
                <option value="">
                  {memory.declared !== null ? "As the repository says" : "Default"} (
                  {describeMemory(memory.fallback)})
                </option>
                {memory.choices.map((mib) => (
                  <option key={mib} value={String(mib)}>
                    {describeMemory(mib)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}

        {keepWarm !== null ? (
          <div className="border-t border-line pt-5">
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-medium text-ink">Keep it warm</p>
                <p
                  id="keep-warm-detail"
                  className="mt-1 text-[11.5px] leading-relaxed text-ink-subtle"
                >
                  An app sleeps when nobody is using it, so the first request after a
                  quiet spell waits for it to start. Keeping one instance running removes
                  that wait, and is billed at ${warmMonthly} a month while it is on.
                  {canKeepWarm ? "" : " It needs a paid plan."}
                </p>
              </div>
              <Switch
                on={warm}
                label={`Keep ${appName} warm`}
                describedBy="keep-warm-detail"
                busy={pending}
                disabled={!canKeepWarm && !warm}
                onChange={(on) => {
                  setError(null);
                  startTransition(async () => {
                    const result = await setKeepWarm(spaceSlug, appSlug, on);
                    if (result.ok) {
                      setWarm(result.data.warm);
                      router.refresh();
                    } else setError(result.error);
                  });
                }}
              />
            </div>
          </div>
        ) : null}

        <div className="border-t border-line pt-5">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-medium text-ink">
                Tell this app who is calling
              </p>
              <p
                id="tells-detail"
                className="mt-1 text-[11.5px] leading-relaxed text-ink-subtle"
              >
                For an app that signs its own users in. Cira sends a signed statement
                naming the person behind each call, which the app checks against{" "}
                <a
                  href="/.well-known/cira-jwks.json"
                  className="underline underline-offset-4 hover:text-ink"
                >
                  Cira&rsquo;s published keys
                </a>
                . It says who they are and nothing they could be signed in with, and it
                lasts a minute.
                {canTellWhoIsCalling
                  ? ""
                  : " This Cira has no signing key yet, so it cannot vouch for anyone."}
              </p>
            </div>
            <Switch
              on={tells}
              label={`Tell ${appName} who is calling`}
              describedBy="tells-detail"
              busy={pending}
              disabled={!canTellWhoIsCalling && !tells}
              onChange={(on) => {
                setError(null);
                startTransition(async () => {
                  const result = await setTellsWhoIsCalling(spaceSlug, appSlug, on);
                  if (result.ok) {
                    setTells(result.data.tell);
                    router.refresh();
                  } else setError(result.error);
                });
              }}
            />
          </div>
        </div>

        <div className="border-t border-line pt-5">
          <p className="text-[12.5px] font-medium text-ink">Delete this app</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-subtle">
            Takes the running app down and removes it from {spaceSlug}. Its deploy history
            goes with it. This cannot be undone.
          </p>

          {!confirming ? (
            <button
              ref={deleteButton}
              type="button"
              onClick={() => setConfirming(true)}
              className="btn btn-secondary mt-3 text-failed hover:border-failed hover:bg-failed/5 hover:text-failed"
            >
              Delete
            </button>
          ) : (
            <div className="enter-fade mt-3 flex flex-col gap-2">
              <label htmlFor="confirm" className="text-[11.5px] text-ink-muted">
                Type <span className="font-medium text-ink">{appName}</span> to confirm.
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  id="confirm"
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  autoFocus
                  placeholder={appName}
                  className="field field-danger flex-1"
                />
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(false);
                    // Back to Delete, which the confirmation replaced.
                    requestAnimationFrame(() => deleteButton.current?.focus());
                  }}
                  className="btn btn-ghost"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={remove}
                  disabled={confirmName.trim() !== appName.trim()}
                  aria-disabled={pending || undefined}
                  className="btn btn-danger"
                >
                  {pending ? "Deleting..." : "Delete for good"}
                </button>
              </div>
            </div>
          )}
        </div>

        {error !== null ? (
          <p role="alert" className="text-[12.5px] text-failed">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}
