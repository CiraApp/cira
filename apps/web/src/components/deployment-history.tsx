"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DeploymentStatus } from "@cira/core";
import { fetchBuildLogs, type LogsResult } from "@/lib/log-actions";
import { planRollback, rollBackTo, type RollbackPlan } from "@/lib/rollback-actions";
import { SectionLink } from "./section-link";
import { StatusDot } from "./status-dot";

export interface DeployRow {
  id: string;
  status: string;
  createdAt: string;
  relative: string;
  /** Why it failed, in plain words, when that is known. */
  reason: string | null;
  /** What went wrong without stopping it. */
  warning: string | null;
  /** When this deploy put the app back on an earlier one, how long ago that was. */
  restoredFrom: string | null;
  /** Who started it, when known. */
  by: string | null;
  /** What it was built from - "3f9a1c2 Fix the filter" - when known. */
  source: string | null;
}

/** Keyed by every status, so a new one cannot reach this list unlabelled. */
const LABEL: Record<DeploymentStatus, string> = {
  live: "Deployed",
  failed: "Failed",
  removed: "Removed",
  queued: "Queued",
  building: "Building",
  deploying: "Deploying",
  superseded: "Replaced by a newer deploy",
};

/** Named for the step it came from, which is the one the deploy stopped at. */
const LOG_TITLE = {
  build: "Build log",
  release: "What the release command printed",
  start: "What the app printed as it started",
} as const;

/**
 * What has been shipped, and why a deploy failed.
 *
 * The logs are the point. Telling someone their deploy failed and then making
 * them go and ask the provider is the same as not telling them.
 */
export function DeploymentHistory({
  spaceSlug,
  appSlug,
  deploys,
  logsHref,
  canManage,
}: {
  spaceSlug: string;
  appSlug: string;
  deploys: DeployRow[];
  /** The app's runtime logs, for whoever may read them. */
  logsHref: string | null;
  /** Whether this person may change what the app runs. */
  canManage: boolean;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<string, LogsResult>>({});
  const [plans, setPlans] = useState<Record<string, RollbackPlan | null>>({});
  const [armed, setArmed] = useState<string | null>(null);
  const [going, setGoing] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const [, startTransition] = useTransition();
  const logRef = useRef<HTMLPreElement>(null);
  // Where focus goes as the rollback confirmation opens and closes: the
  // button pressed disappears each time, and focus must not go with it.
  const confirmRef = useRef<HTMLButtonElement>(null);
  const offerRef = useRef<HTMLButtonElement>(null);
  const [returnFocus, setReturnFocus] = useState(false);

  useEffect(() => {
    if (armed !== null) confirmRef.current?.focus();
    else if (returnFocus) {
      offerRef.current?.focus();
      setReturnFocus(false);
    }
  }, [armed, returnFocus]);

  // A failed build is read from the bottom: the error is the last thing that
  // happened. Opening at the top means scrolling past the install log to find
  // the one line that matters.
  useEffect(() => {
    const pre = logRef.current;
    if (pre !== null) pre.scrollTop = pre.scrollHeight;
  }, [openId, logs]);

  const toggle = (id: string) => {
    setArmed(null);
    setFailure(null);
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);

    if (logs[id] === undefined) {
      startTransition(async () => {
        const result = await fetchBuildLogs(spaceSlug, appSlug, id);
        setLogs((prev) => ({ ...prev, [id]: result }));
      });
    }

    // What going back to this one would mean is worked out while the logs
    // load, so the offer arrives with the sentence that qualifies it rather
    // than appearing plain and then growing a warning underneath.
    if (canManage && plans[id] === undefined) {
      startTransition(async () => {
        const result = await planRollback(spaceSlug, appSlug, id);
        setPlans((prev) => ({ ...prev, [id]: result.ok ? result.plan : null }));
      });
    }
  };

  const goBack = (id: string) => {
    setGoing(id);
    setFailure(null);
    startTransition(async () => {
      const result = await rollBackTo(spaceSlug, appSlug, id);
      setGoing(null);
      setArmed(null);
      if (result.ok) {
        // The row it was on is redrawn as the list refreshes; this is what
        // tells a screen reader that anything happened at all.
        setSaid("Going back to that build. The new deploy is at the top of the list.");
        router.refresh();
      } else setFailure(result.error);
    });
  };

  if (deploys.length === 0) return null;

  return (
    <section id="deploys" className="enter-up mt-10 scroll-mt-6">
      <p role="status" className="sr-only">
        {said}
      </p>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">Deploys</h2>
        {logsHref !== null ? (
          <SectionLink href={logsHref}>Runtime logs</SectionLink>
        ) : null}
      </div>

      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-[var(--radius-edge)] border border-line bg-surface">
        {deploys.map((d) => {
          const isOpen = openId === d.id;
          const result = logs[d.id];
          const plan = plans[d.id];

          return (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => toggle(d.id)}
                aria-expanded={isOpen}
                aria-controls={`deploy-${d.id}-detail`}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-sunken/50"
              >
                <StatusDot
                  status={d.status}
                  label={LABEL[d.status as DeploymentStatus] ?? d.status}
                />
                {/* Which build, and whose: with several people shipping one
                    app, "Deployed, 5 minutes ago" said neither, and a
                    rollback is a choice between builds. */}
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink-subtle">
                  {d.restoredFrom !== null ? (
                    `back to the build from ${d.restoredFrom}`
                  ) : d.source !== null ? (
                    <span className="font-mono text-[11.5px]">{d.source}</span>
                  ) : null}
                </span>
                <span className="tabular shrink-0 text-[12px] text-ink-subtle">
                  {d.by === null ? d.relative : `${d.by}, ${d.relative}`}
                </span>
                <svg
                  viewBox="0 0 12 12"
                  aria-hidden="true"
                  className={`h-3 w-3 shrink-0 text-ink-subtle transition-transform duration-300 ease-[var(--ease-spring)] ${
                    isOpen ? "rotate-90" : ""
                  }`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m4.5 2.5 3.5 3.5-3.5 3.5" />
                </svg>
              </button>

              {d.reason !== null && d.status === "failed" ? (
                <p className="-mt-1 px-4 pb-3 pl-[34px] text-[12.5px] leading-relaxed text-ink-muted">
                  {d.reason}
                </p>
              ) : null}
              {d.warning !== null && d.status !== "failed" ? (
                <p className="-mt-1 px-4 pb-3 pl-[34px] text-[12.5px] leading-relaxed text-pending">
                  {d.warning}
                </p>
              ) : null}

              {isOpen ? (
                <div
                  id={`deploy-${d.id}-detail`}
                  className="enter-fade border-t border-line bg-sunken/60 px-4 py-3.5"
                >
                  {result === undefined ? (
                    <p className="text-[12.5px] text-ink-muted">Fetching logs...</p>
                  ) : result.ok ? (
                    <>
                      <p className="mb-2 text-[11.5px] text-ink-subtle">
                        {LOG_TITLE[result.step]}
                      </p>
                      <pre
                        ref={logRef}
                        // Scrollable, so it has to be reachable to be read by
                        // anyone not using a mouse wheel.
                        tabIndex={0}
                        role="region"
                        aria-label={LOG_TITLE[result.step]}
                        className="max-h-80 overflow-auto font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink-muted"
                      >
                        {result.lines.map((l) => l.message).join("\n")}
                      </pre>
                    </>
                  ) : (
                    <p className="text-[12.5px] text-ink-muted">{result.error}</p>
                  )}

                  {plan !== undefined && plan !== null ? (
                    <div className="mt-3.5 border-t border-line pt-3.5">
                      {armed === d.id ? (
                        <>
                          <p className="text-[12.5px] leading-relaxed text-ink-muted">
                            {plan.current
                              ? "This build goes out again, with the variables the app has now. Nothing else changes."
                              : "The app goes back to this build - its web traffic, its workers and its scheduled runs - with the variables it has now."}
                            {plan.ranSetup ? (
                              <>
                                {" "}
                                <span className="text-pending">
                                  A deploy since this one ran a setup command. Going back
                                  runs the older code, but does not undo what that command
                                  changed in the database.
                                </span>
                              </>
                            ) : null}
                          </p>
                          <div className="mt-2.5 flex flex-wrap gap-2">
                            <button
                              ref={confirmRef}
                              type="button"
                              disabled={going !== null}
                              onClick={() => goBack(d.id)}
                              className="btn btn-primary"
                            >
                              {going === d.id
                                ? "Going back..."
                                : plan.current
                                  ? "Deploy it again"
                                  : "Go back to this build"}
                            </button>
                            <button
                              type="button"
                              disabled={going !== null}
                              onClick={() => {
                                setReturnFocus(true);
                                setArmed(null);
                              }}
                              className="btn btn-ghost px-2 text-[12px]"
                            >
                              Keep what is running
                            </button>
                          </div>
                        </>
                      ) : (
                        <button
                          type="button"
                          ref={offerRef}
                          onClick={() => {
                            setFailure(null);
                            setArmed(d.id);
                          }}
                          className="btn btn-secondary"
                        >
                          {plan.current
                            ? "Deploy this version again"
                            : "Roll back to this"}
                        </button>
                      )}
                      {failure !== null && armed === null && going === null ? (
                        <p role="alert" className="mt-2 text-[12.5px] text-failed">
                          {failure}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
