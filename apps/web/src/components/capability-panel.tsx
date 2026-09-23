"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Capability } from "@cira/core";
import { setCapabilityEnabled } from "@/lib/capability-actions";
import { SectionLink } from "./section-link";
import { LiveStatus } from "./ui/live-status";
import {
  retryCapabilityAnalysis,
  verifyPendingCapabilities,
} from "@/lib/capability-retry";

/**
 * What Cira found this app can do.
 *
 * Grouped by what the app would have to be trusted with rather than by name,
 * because that is the only question worth answering here: the enabled ones are
 * already answering agents, and everything else is waiting - on a person, or
 * on the app itself.
 *
 * That second wait is worth showing rather than hiding. A capability is found
 * by reading the code, which can be wrong, so nothing is offered to an agent
 * until the running app has confirmed it serves the route. That check happens
 * seconds after a deploy, and during those seconds "off" would be a lie.
 *
 * Nobody wrote any of this. It is the detected set, and the only control is a
 * switch - the spec is explicit that this should not become a moderation
 * workflow.
 */
export function CapabilityPanel({
  capabilities,
  canManage,
  analyzed,
  running,
  spaceSlug,
  appSlug,
  consoleHref,
  tellsWhoIsCalling,
}: {
  capabilities: Capability[];
  canManage: boolean;
  /** Whether the analyzer has ever finished a run against this app. */
  analyzed: boolean;
  /** Whether there is something deployed to read the code of. */
  running: boolean;
  spaceSlug: string;
  appSlug: string;
  /** Where these can be run by hand. */
  consoleHref: string;
  /** Whether Cira already tells this app who is behind each call. */
  tellsWhoIsCalling: boolean;
}) {
  const router = useRouter();
  const asked = useRef(false);
  // Turning a capability on or off moves it to another group, which draws it
  // afresh: the button that was pressed is gone. The new one takes focus back,
  // and the change is said aloud, since nothing visible happens where the
  // person was looking.
  const moved = useRef<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const toggled = (capability: Capability, enabled: boolean) => {
    moved.current = capability.id;
    setSaid(
      enabled
        ? `${capability.name} enabled. Agents can find and run it.`
        : `${capability.name} disabled.`,
    );
  };
  const waiting = capabilities.some((capability) => capability.reach === "pending");

  // Anything still waiting to be asked about gets asked about, here, because
  // somebody is looking. Finding a capability and confirming it are two acts,
  // and whatever interrupts between them - a failed deploy, a closed laptop,
  // a version of this code that only did the first - used to leave the set
  // stuck on "Checking" with nothing anywhere to move it along. The one
  // control that ran verification lived in the empty state, which by
  // definition was not on screen once there was anything to look at.
  useEffect(() => {
    if (!waiting || !running || asked.current) return;
    asked.current = true;

    void verifyPendingCapabilities(spaceSlug, appSlug).then((result) => {
      if (result.settled) router.refresh();
    });
  }, [waiting, running, spaceSlug, appSlug, router]);

  // An empty list used to draw nothing at all, which quietly told whoever was
  // looking that this app has nothing to offer. Sometimes that is true. Often
  // it means the one step of a deploy that depends on a model did not happen,
  // and the app has been sitting there ever since looking like it had no
  // capabilities rather than like nobody had looked.
  if (capabilities.length === 0) {
    return (
      <Empty
        analyzed={analyzed}
        canManage={canManage}
        running={running}
        spaceSlug={spaceSlug}
        appSlug={appSlug}
      />
    );
  }

  const checking = capabilities.filter((c) => c.reach === "pending");
  const live = capabilities.filter((c) => c.reach === "callable" && c.enabled);
  const review = capabilities.filter((c) => c.reach === "callable" && !c.enabled);
  const refused = capabilities.filter((c) => c.reach === "refused");

  return (
    <section className="enter-up mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">
          Capabilities
        </h2>
        <p className="flex items-baseline gap-3 text-[12px] text-ink-subtle">
          <span className="hidden sm:inline">
            Detected from the code when this app was deployed
          </span>
          <SectionLink href={consoleHref}>Run them in the console</SectionLink>
        </p>
      </div>

      <div className="mt-3 flex flex-col gap-4">
        <Group
          title="Checking"
          note="Asking the app whether it really serves these."
          items={checking}
          canManage={false}
          busy
        />
        <Group
          title="Enabled"
          note="Agents can find and run these."
          items={live}
          canManage={canManage}
          moved={moved}
          onToggled={toggled}
        />
        <Group
          title="Review"
          note="Registered, but off until someone turns them on."
          items={review}
          canManage={canManage}
          moved={moved}
          onToggled={toggled}
        />
        {/*
          Shown rather than hidden, and shown with the reason. These are real
          routes correctly described - the app served every one of them - and
          the only thing standing between an agent and them is that the app
          signs its own users in and does not take Cira's word for who is
          calling. Whoever manages the app is pointed at the one setting that
          can change that; the app's code has to accept it too.
        */}
        <Group
          title="Refused"
          note={
            <>
              Real routes behind the app&rsquo;s own sign-in. Agents cannot reach them
              {tellsWhoIsCalling ? (
                " until the app accepts Cira\u2019s statement of who is calling."
              ) : canManage ? (
                <>
                  {" "}
                  unless the app is{" "}
                  <a
                    href="#settings"
                    className="underline underline-offset-4 hover:text-ink"
                  >
                    told who is calling
                  </a>{" "}
                  and accepts it.
                </>
              ) : (
                "."
              )}
            </>
          }
          items={refused}
          canManage={false}
        />
      </div>
      <LiveStatus message={said} />
    </section>
  );
}

function Group({
  title,
  note,
  items,
  canManage,
  busy = false,
  moved,
  onToggled,
}: {
  title: string;
  note: React.ReactNode;
  items: Capability[];
  canManage: boolean;
  moved?: React.RefObject<string | null>;
  onToggled?: (capability: Capability, enabled: boolean) => void;
  /** Still being checked, so the group says so and offers no switch. */
  busy?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <div>
      <div className="flex items-baseline gap-2.5">
        <h3 className="eyebrow inline-flex items-center gap-1.5">
          {busy ? (
            <span
              aria-hidden="true"
              className="ping relative h-[5px] w-[5px] rounded-full bg-pending text-pending"
            />
          ) : null}
          {title}
        </h3>
        <p className="text-[11px] text-ink-subtle">{note}</p>
      </div>

      <ul className="mt-2 divide-y divide-line overflow-hidden rounded-[var(--radius-edge)] border border-line bg-surface">
        {items.map((capability) => (
          <Row
            key={capability.id}
            capability={capability}
            canManage={canManage}
            moved={moved}
            onToggled={onToggled}
          />
        ))}
      </ul>
    </div>
  );
}

function Row({
  capability,
  canManage,
  moved,
  onToggled,
}: {
  capability: Capability;
  canManage: boolean;
  moved?: React.RefObject<string | null> | undefined;
  onToggled?: ((capability: Capability, enabled: boolean) => void) | undefined;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (moved?.current !== capability.id) return;
    moved.current = null;
    button.current?.focus();
  }, [moved, capability.id]);

  const toggle = () => {
    if (pending) return;
    setError(null);
    const enabled = !capability.enabled;
    startTransition(async () => {
      const result = await setCapabilityEnabled(capability.id, enabled);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onToggled?.(capability, enabled);
      router.refresh();
    });
  };

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 transition-colors duration-150 hover:bg-sunken/40">
      <RiskMark risk={capability.risk} />

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[12.5px] font-medium text-ink">
            {capability.name}
          </span>
          {/* Not an eyebrow: paths are case-sensitive, and uppercasing one
              showed a route the app does not serve. */}
          <span className="font-mono text-[11px] break-all text-ink-subtle">
            <span className="font-semibold">{capability.target.method}</span>{" "}
            {capability.target.path}
          </span>
        </span>
        <span className="mt-0.5 block text-[12px] text-ink-muted">
          {capability.description}
        </span>
        {error !== null ? (
          <span role="alert" className="enter-fade mt-1 block text-[11.5px] text-failed">
            {error}
          </span>
        ) : null}
      </span>

      {canManage ? (
        <button
          type="button"
          ref={button}
          onClick={toggle}
          aria-disabled={pending || undefined}
          className="btn btn-secondary shrink-0 px-2.5 py-1.5 text-[12px]"
        >
          {pending ? "Saving..." : capability.enabled ? "Disable" : "Enable"}
          <span className="sr-only"> {capability.name}</span>
        </button>
      ) : null}
    </li>
  );
}

/**
 * Risk as a shape, not only a word.
 *
 * Read is the common case and gets the quietest mark; the two that change
 * something get colour, because that is the distinction someone scanning this
 * list actually needs.
 */
function RiskMark({ risk }: { risk: Capability["risk"] }) {
  const style =
    risk === "read"
      ? "border-line bg-sunken text-ink-subtle"
      : "border-pending/40 bg-pending/10 text-pending";

  return (
    <span
      title={`${risk} capability`}
      className={`inline-flex shrink-0 items-center rounded-[var(--radius-edge)] border px-1.5 py-[3px] text-[10px] font-semibold tracking-[0.06em] uppercase ${style}`}
    >
      {risk}
    </span>
  );
}

/**
 * What is said when there is nothing on the shelf.
 *
 * The two reasons are worth telling apart. An app whose code was read and
 * which genuinely serves nothing an agent could call is finished and correct,
 * and inviting someone to keep trying would be a lie. An app nobody has
 * managed to read is unfinished, and the only useful thing to offer is another
 * go - which costs nothing but a moment, because the code it was built from is
 * still where the build left it.
 */
function Empty({
  analyzed,
  canManage,
  running,
  spaceSlug,
  appSlug,
}: {
  analyzed: boolean;
  canManage: boolean;
  running: boolean;
  spaceSlug: string;
  appSlug: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const retry = () => {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const result = await retryCapabilityAnalysis(spaceSlug, appSlug);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  };

  return (
    <section className="enter-up mt-10">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">
          Capabilities
        </h2>
        <p className="text-[12px] text-ink-subtle">
          Detected from the code when this app was deployed
        </p>
      </div>

      <div className="mt-3 rounded-[var(--radius-edge)] border border-line bg-surface px-4 py-4">
        <p className="text-[13px] text-ink">
          {analyzed
            ? "Cira read this app's code and found nothing an agent could call."
            : "Cira has not worked out what this app can do."}
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
          {analyzed
            ? "Nothing here is missing. Some apps are built for people rather than for agents."
            : "Reading the code is the one part of a deploy that can fail on its own, and the app keeps running when it does. The code is still stored, so this can be tried again without deploying."}
        </p>

        {error !== null ? (
          <p role="alert" className="enter-fade mt-2 text-[12px] text-failed">
            {error}
          </p>
        ) : null}

        {canManage && running ? (
          <button
            type="button"
            onClick={retry}
            aria-disabled={pending || undefined}
            className="btn btn-secondary mt-3 px-2.5 py-1.5 text-[12px]"
          >
            {pending
              ? "Reading the code..."
              : analyzed
                ? "Look again"
                : "Find capabilities"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
