"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { fetchBuildLogs, type LogsResult } from "@/lib/log-actions";

export interface DeployRow {
  id: string;
  status: string;
  createdAt: string;
  relative: string;
}

const DOT: Record<string, string> = {
  live: "bg-live",
  failed: "bg-failed",
  removed: "bg-ink-subtle",
  queued: "bg-pending animate-breathe",
  building: "bg-pending animate-breathe",
  deploying: "bg-pending animate-breathe",
};

const LABEL: Record<string, string> = {
  live: "Deployed",
  failed: "Failed",
  removed: "Removed",
  queued: "Queued",
  building: "Building",
  deploying: "Deploying",
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
}: {
  spaceSlug: string;
  appSlug: string;
  deploys: DeployRow[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<string, LogsResult>>({});
  const [pending, startTransition] = useTransition();
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
    <section className="mt-10">
      <h2 className="text-[15px] font-semibold text-ink">Deploys</h2>

      <ul className="mt-3 divide-y divide-border overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-rest)]">
        {deploys.map((d) => {
          const isOpen = openId === d.id;
          const result = logs[d.id];

          return (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => toggle(d.id)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-canvas"
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[d.status] ?? "bg-ink-subtle"}`}
                />
                <span className="flex-1 text-[14px] text-ink">
                  {LABEL[d.status] ?? d.status}
                </span>
                <span className="text-[13px] text-ink-subtle">{d.relative}</span>
                <span
                  aria-hidden="true"
                  className={`text-[11px] text-ink-subtle transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
                >
                  &#9656;
                </span>
              </button>

              {isOpen ? (
                <div className="animate-fade-in border-t border-border bg-canvas px-5 py-4">
                  {result === undefined && pending ? (
                    <p className="text-[13px] text-ink-muted">Fetching logs...</p>
                  ) : result === undefined ? (
                    <p className="text-[13px] text-ink-muted">Fetching logs...</p>
                  ) : result.ok ? (
                    <pre
                      ref={logRef}
                      className="max-h-80 overflow-auto font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink-muted"
                    >
                      {result.lines.map((l) => l.message).join("\n")}
                    </pre>
                  ) : (
                    <p className="text-[13px] text-ink-muted">{result.error}</p>
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
