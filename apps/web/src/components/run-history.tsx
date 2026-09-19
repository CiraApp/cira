import type { RunRecord } from "@/lib/invocations";

/**
 * Who ran what, from where, and how it ended.
 *
 * The first thing a company asks after a refund nobody remembers issuing, and
 * exactly as much as answers it: never what was sent or what came back, which
 * are the app's data and not Cira's to keep.
 */
export function RunHistory({ runs }: { runs: RunRecord[] }) {
  return (
    <section className="enter-up mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">
          Capability runs
        </h2>
        <p className="text-[12px] text-ink-subtle">
          Who ran what, from where. Never what was sent or returned.
        </p>
      </div>

      {runs.length === 0 ? (
        <p className="mt-3 rounded-[var(--radius-edge)] border border-line bg-surface px-4 py-4 text-[12.5px] text-ink-muted">
          Nothing has been run yet. Runs from agents, Ask Cira and the console appear
          here.
        </p>
      ) : (
        <ul className="mt-3 max-h-[420px] divide-y divide-line overflow-auto rounded-[var(--radius-edge)] border border-line bg-surface">
          {runs.map((run) => (
            <li key={run.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[12px] text-ink">
                  {run.capabilityName}
                </span>
                <span className="mt-0.5 block truncate text-[11.5px] text-ink-subtle">
                  {run.personName} · {VIA[run.via]} ·{" "}
                  <time dateTime={run.at.toISOString()} title={run.at.toISOString()}>
                    {ago(run.at)}
                  </time>
                </span>
              </span>
              <Outcome run={run} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const VIA: Record<RunRecord["via"], string> = {
  mcp: "Agent",
  ask: "Ask Cira",
  console: "Console",
};

/** Stopped before anything was sent, in words. */
const STOPPED: Record<Exclude<RunRecord["outcome"], "ran">, string> = {
  refused: "Refused by the app",
  pending: "Not yet confirmed",
  disabled: "Turned off",
  "invalid-input": "Invalid input",
  unreachable: "App unreachable",
};

function Outcome({ run }: { run: RunRecord }) {
  if (run.outcome !== "ran" || run.status === null) {
    const words = run.outcome === "ran" ? "No answer" : STOPPED[run.outcome];
    return <span className="shrink-0 text-[12px] text-ink-subtle">{words}</span>;
  }
  const good = run.status >= 200 && run.status < 300;
  return (
    <span className="inline-flex shrink-0 items-center gap-2 text-[12px]">
      <span
        className={`rounded-[var(--radius-edge)] border px-1.5 py-px font-mono text-[11px] ${
          good
            ? "border-live/35 bg-live/10 text-live"
            : "border-failed/35 bg-failed/10 text-failed"
        }`}
      >
        {run.status}
      </span>
      {run.elapsedMs !== null ? (
        <span className="tabular text-ink-subtle">{run.elapsedMs} ms</span>
      ) : null}
    </span>
  );
}

/** Coarse, like the rest of the page. */
function ago(at: Date): string {
  const seconds = Math.round((Date.now() - at.getTime()) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
