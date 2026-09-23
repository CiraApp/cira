"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { slugify } from "@cira/core";
import { createSpace, type ActionResult } from "@/lib/actions";
import { joinSpaceByDomain } from "@/lib/join-actions";
import { EntryFrame } from "./entry-frame";
import { NameForm } from "./name-form";

export interface JoinableSpace {
  id: string;
  name: string;
  slug: string;
}

/**
 * The whole of onboarding, on one screen.
 *
 * The spec asks for this to stay extremely light, so it is a few states of a
 * single card rather than a wizard with steps: your name, then join the
 * company that is already here or name a new one, and then a moment that says
 * it worked. Nothing routes anywhere until the person is actually going
 * somewhere.
 *
 * The name comes first because everything after it uses it - the greeting
 * here, the home page, how teammates see you - and because the sign-in
 * provider often has none, which left Cira greeting people by their email
 * address. What it does know is filled in, so for most people this is one
 * press of Enter.
 *
 * Which state opens is decided by their email domain, not by a question. Being
 * asked "do you want to join or create?" when the answer is already known is
 * the kind of setup step this screen exists to avoid.
 */
export function Onboarding({
  firstName,
  lastName,
  domain,
  joinable,
  home,
}: {
  /** What is known already, to fill the name step with. */
  firstName: string | null;
  lastName: string | null;
  domain: string | null;
  joinable: JoinableSpace[];
  /** A space they are already in, when they came here to start another. */
  home: { name: string; slug: string } | null;
}) {
  const [created, setCreated] = useState<{ name: string; slug: string } | null>(null);
  const [founding, setFounding] = useState(joinable.length === 0);
  // Someone who has already told Cira their name - coming back after leaving
  // or deleting their only space - is not asked it again. The name step is
  // for a first visit; a pre-filled form to click through is a question
  // already answered.
  const [named, setNamed] = useState<string | null>(firstName);

  // Each step replaces the last in place, taking the pressed button with it,
  // so focus would fall to the top of the page and the new question go
  // unannounced. It moves to the step's heading instead - but not on arrival,
  // where the page's own first field is the right place to start.
  const step =
    named === null ? "name" : created !== null ? "done" : founding ? "found" : "join";
  const shown = useRef(step);
  useEffect(() => {
    if (shown.current === step) return;
    shown.current = step;
    document.getElementById("entry-title")?.focus();
  }, [step]);

  if (named === null) {
    return (
      <EntryFrame
        eyebrow="Welcome to Cira"
        title="What should we call you?"
        subtitle="This is how Cira greets you, and how your team sees you."
      >
        <NameForm
          firstName={firstName}
          lastName={lastName}
          submitLabel="Continue"
          onSaved={setNamed}
        />
      </EntryFrame>
    );
  }

  const welcome = `Welcome to Cira, ${named}`;

  if (created !== null) {
    return (
      <EntryFrame
        mark="done"
        title={`${created.name} is ready`}
        subtitle="A space with one person in it is not much use yet."
        footer={
          <Link
            href={`/${created.slug}`}
            className="text-[13px] text-ink-muted underline decoration-line-strong underline-offset-4 transition-colors duration-150 hover:text-ink hover:decoration-ink-subtle"
          >
            Go to {created.name}
          </Link>
        }
      >
        <Link
          href={`/${created.slug}/~/members?invite=1`}
          className="btn btn-primary btn-lg w-full"
        >
          Invite your team
        </Link>
      </EntryFrame>
    );
  }

  if (!founding) {
    return (
      <EntryFrame
        eyebrow={welcome}
        title={
          joinable.length === 1 ? "Your team is already here" : "Your teams are here"
        }
        subtitle={`We recognised ${domain}, so you can join without an invite.`}
        footer={
          <button
            type="button"
            onClick={() => setFounding(true)}
            className="text-[13px] text-ink-muted underline decoration-line-strong underline-offset-4 transition-colors duration-150 hover:text-ink hover:decoration-ink-subtle"
          >
            Or start a separate space
          </button>
        }
      >
        <JoinList spaces={joinable} domain={domain} />
      </EntryFrame>
    );
  }

  return (
    <EntryFrame
      // Someone who already has a space is not new to Cira, and this is not
      // their first company; the words say so.
      eyebrow={home === null ? welcome : "Another space"}
      title={home === null ? "Create your space" : "Create a space"}
      subtitle="A space is your company. Everything your team deploys lives inside it."
      footer={
        joinable.length > 0 ? (
          <button
            type="button"
            onClick={() => setFounding(false)}
            className="text-[13px] text-ink-muted underline decoration-line-strong underline-offset-4 transition-colors duration-150 hover:text-ink hover:decoration-ink-subtle"
          >
            Back to joining {joinable.length === 1 ? joinable[0]?.name : "your team"}
          </button>
        ) : home !== null ? (
          <Link
            href={`/${home.slug}`}
            className="text-[13px] text-ink-muted underline decoration-line-strong underline-offset-4 transition-colors duration-150 hover:text-ink hover:decoration-ink-subtle"
          >
            Back to {home.name}
          </Link>
        ) : undefined
      }
    >
      <CreateForm domain={domain} onCreated={setCreated} />
    </EntryFrame>
  );
}

/**
 * One field, and the address it is about to produce.
 *
 * The slug preview is the only thing here that is not strictly required, and
 * it earns its place: it shows what a space actually is - a place with an
 * address - without a sentence explaining it, and it is the same `slugify` the
 * server will run, so it cannot promise an address the server would not give.
 */
function CreateForm({
  domain,
  onCreated,
}: {
  domain: string | null;
  onCreated: (space: { name: string; slug: string }) => void;
}) {
  const [name, setName] = useState("");
  const [state, action, pending] = useActionState<
    ActionResult<{ slug: string }> | null,
    FormData
  >(createSpace, null);

  useEffect(() => {
    if (state?.ok === true) onCreated({ name: name.trim(), slug: state.data.slug });
  }, [state, name, onCreated]);

  const preview = slugify(name);

  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (pending) event.preventDefault();
      }}
      className="flex flex-col"
    >
      <label htmlFor="space-name" className="sr-only">
        Company or team name
      </label>

      <input
        id="space-name"
        name="name"
        type="text"
        required
        autoFocus
        autoComplete="organization"
        spellCheck={false}
        placeholder="Acme"
        value={name}
        onChange={(event) => setName(event.target.value)}
        aria-describedby={state?.ok === false ? "space-name-error" : undefined}
        className="field py-3 text-[15px]"
      />

      {/* Reserves its own line whether or not it has anything to say, so the
          button does not jump down the page on the first keystroke. */}
      <p className="mt-2 h-4 font-mono text-[11.5px] text-ink-subtle">
        {preview === "" ? null : (
          <span className="enter-fade">
            Lives at <span className="text-ink-muted">/{preview}</span>
          </span>
        )}
      </p>

      {state?.ok === false ? (
        <p
          id="space-name-error"
          role="alert"
          className="enter-fade mt-1 text-[12.5px] text-failed"
        >
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={preview === ""}
        aria-disabled={pending || undefined}
        className="btn btn-primary btn-lg mt-3 w-full"
      >
        {pending ? "Creating..." : "Create space"}
      </button>

      {domain !== null ? (
        <p className="mt-3 text-[11.5px] leading-relaxed text-ink-subtle">
          Anyone with a verified @{domain} address will be able to join it.
        </p>
      ) : null}
    </form>
  );
}

/**
 * Joining is one click and the obvious action: founding a second copy of your
 * own workplace should take more effort than joining the real one.
 */
function JoinList({
  spaces,
  domain,
}: {
  spaces: JoinableSpace[];
  domain: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const join = async (slug: string) => {
    if (busy !== null) return;
    setError(null);
    setBusy(slug);
    const result = await joinSpaceByDomain(slug);
    if (result.ok) {
      router.push(`/${result.spaceSlug}`);
    } else {
      setError(result.error);
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {spaces.map((space) => (
        <button
          key={space.id}
          type="button"
          onClick={() => join(space.slug)}
          aria-disabled={busy !== null || undefined}
          className="group flex items-center justify-between gap-4 rounded-[var(--radius-edge)] border border-line bg-surface px-4 py-3.5 text-left transition-[transform,border-color,box-shadow] duration-300 ease-[var(--ease-settle)] hover:-translate-y-[2px] hover:border-line-strong hover:shadow-[var(--shadow-float)] aria-disabled:translate-y-0 aria-disabled:cursor-progress aria-disabled:opacity-60"
        >
          <span className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-edge)] bg-accent text-[13px] font-bold text-accent-ink"
            >
              {space.name.charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-medium text-ink">
                {space.name}
              </span>
              {domain !== null ? (
                <span className="block truncate text-[11.5px] text-ink-subtle">
                  Everyone at {domain}
                </span>
              ) : null}
            </span>
          </span>

          <span className="flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-accent">
            {busy === space.slug ? "Joining..." : "Join"}
            <svg
              viewBox="0 0 12 12"
              aria-hidden="true"
              className="h-3 w-3 transition-transform duration-300 ease-[var(--ease-spring)] group-hover:translate-x-0.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2.5 6h7M6.5 3l3 3-3 3" />
            </svg>
          </span>
        </button>
      ))}

      {error !== null ? (
        <p role="alert" className="enter-fade text-[12.5px] text-failed">
          {error}
        </p>
      ) : null}
    </div>
  );
}
