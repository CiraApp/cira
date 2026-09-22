"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { DeploymentStatus } from "@cira/core";
import { fetchBuildLogs, type LogsResult } from "@/lib/log-actions";
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
}: {
  spaceSlug: string;
  appSlug: string;
  deploys: DeployRow[];
  /** The app's runtime logs, for whoever may read them. */
  logsHref: string | null;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<string, LogsResult>>({});
  const [, startTransition] = useTransition();
  const logRef = useRef<HTMLPreElement>(null);

  // A failed build is read from the bottom: the error is the last thing that
  // happened. Opening at the top means scrolling past the install log to find
  // the one line that matters.
  useEffect(() => {
    const pre = logRef.current;
    if (pre !== null) pre.scrollTop = pre.scrollHeight;
  }, [openId, logs]);

  const toggle = (id: string) => {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    if (logs[id] !== undefined) return;

    startTransition(async () => {
      const result = await fetchBuildLogs(spaceSlug, appSlug, id);
      setLogs((prev) => ({ ...prev, [id]: result }));
    });
  };

  if (deploys.length === 0) return null;

  return (
    <section id="deploys" className="enter-up mt-10 scroll-mt-6">
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

          return (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => toggle(d.id)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-sunken/50"
              >
                <StatusDot
                  status={d.status}
                  label={LABEL[d.status as DeploymentStatus] ?? d.status}
                />
                <span className="flex-1" />
                <span className="tabular text-[12px] text-ink-subtle">{d.relative}</span>
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
                <div className="enter-fade border-t border-line bg-sunken/60 px-4 py-3.5">
                  {result === undefined ? (
                    <p className="text-[12.5px] text-ink-muted">Fetching logs...</p>
                  ) : result.ok ? (
                    <pre
                      ref={logRef}
                      className="max-h-80 overflow-auto font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink-muted"
                    >
                      {result.lines.map((l) => l.message).join("\n")}
                    </pre>
                  ) : (
                    <p className="text-[12.5px] text-ink-muted">{result.error}</p>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
