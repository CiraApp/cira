"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { describeSchedule, parseSchedule } from "@cira/core/schedule";
import type { ProcessView } from "@/lib/processes";
import { runProcessNow, scheduleProcess, switchProcess } from "@/lib/process-actions";
import { SectionLink } from "./section-link";

/**
 * What an app runs besides serving requests: its workers and scheduled runs.
 *
 * Found in the repository when it was deployed, and all off until someone who
 * manages the app turns them on - they run code nobody is watching, and a
 * worker costs money every hour it is on. Each says what it runs, whether it
 * is on, and what happened last.
 */

/**
 * A worker's rough monthly cost while on: one always-running instance of the
 * size the limits record gives it, at Cloud Run's instance-based rates
 * (about $0.000018 a vCPU-second and $0.000002 a GiB-second). Stated so the
 * switch is not a surprise on the bill.
 */
const WORKER_MONTHLY = "about $50 a month";

export function ProcessPanel({
  processes,
  spaceSlug,
  appSlug,
  logsHref,
  servesWeb,
}: {
  processes: ProcessView[];
  spaceSlug: string;
  appSlug: string;
  logsHref: string;
  /** Whether the app also has a web process, to list it for the whole picture. */
  servesWeb: boolean;
}) {
  if (processes.length === 0) return null;
  const anyWorker = processes.some((p) => p.kind === "worker");

  return (
    <section className="enter-up mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">
          Processes
        </h2>
        <p className="text-[12px] text-ink-subtle">
          Found in the repository when it was deployed
        </p>
      </div>

      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-[var(--radius-edge)] border border-line bg-surface">
        {servesWeb ? (
          <li className="flex items-center gap-3 px-4 py-3">
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <Kind kind="web" />
                <span className="font-mono text-[12.5px] text-ink">web</span>
              </span>
              <span className="mt-1 block text-[12px] text-ink-muted">
                Answers requests at the app&apos;s address, and scales to nothing when
                idle.
              </span>
            </span>
          </li>
        ) : null}
        {processes.map((process) => (
          <Row
            key={process.name}
            process={process}
            spaceSlug={spaceSlug}
            appSlug={appSlug}
            logsHref={`${logsHref}?process=${encodeURIComponent(process.name)}`}
          />
        ))}
      </ul>

      {anyWorker ? (
        <p className="mt-2 text-[11.5px] text-ink-subtle">
          A worker runs all the time, and costs {WORKER_MONTHLY} while it is on.
        </p>
      ) : null}
    </section>
  );
}

function Row({
  process,
  spaceSlug,
  appSlug,
  logsHref,
}: {
  process: ProcessView;
  spaceSlug: string;
  appSlug: string;
  logsHref: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const act = (
    work: () => Promise<{ ok: true } | { ok: false; error: string }>,
    done?: string,
  ) => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (done !== undefined) setNotice(done);
      setEditing(false);
      router.refresh();
    });
  };

  const noTimetable = process.kind === "scheduled" && process.schedule === null;
  const missing =
    (process.state?.kind === "worker" && process.state.health === "missing") ||
    (process.state?.kind === "scheduled" && !process.state.exists);

  return (
    <li className="px-4 py-3">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:gap-3">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <Kind kind={process.kind} />
            <span className="font-mono text-[12.5px] text-ink">{process.name}</span>
          </span>
          <span className="mt-1 block truncate font-mono text-[11.5px] text-ink-subtle">
            {process.command}
          </span>
          <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-ink-muted">
            <Status process={process} missing={missing} />
            {process.kind === "scheduled" ? (
              process.scheduleWords === null ? (
                <span className="text-ink-subtle">No timetable yet</span>
              ) : (
                <span>
                  <span className="text-ink">{process.scheduleWords}</span>
                  {process.enabled && process.nextRunAt !== null ? (
                    <span className="text-ink-subtle">
                      {" "}
                      · next {ahead(process.nextRunAt)}
                    </span>
                  ) : null}
                </span>
              )
            ) : null}
            <span className="text-ink-subtle">from {process.source}</span>
            {process.kind === "worker" && !missing ? (
              <SectionLink href={logsHref}>Logs</SectionLink>
            ) : null}
          </span>
        </span>

        <span className="flex items-center gap-1.5 sm:shrink-0">
          {process.kind === "scheduled" ? (
            <>
              <button
                type="button"
                disabled={pending || missing}
                onClick={() =>
                  act(() => runProcessNow(spaceSlug, appSlug, process.name), "Started.")
                }
                className="btn btn-secondary px-2.5 py-1.5 text-[12px]"
              >
                Run now
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setEditing((open) => !open);
                  setError(null);
                }}
                aria-expanded={editing}
                className="btn btn-secondary px-2.5 py-1.5 text-[12px]"
              >
                {noTimetable ? "Set a timetable" : "Edit"}
              </button>
            </>
          ) : null}
          <Switch
            on={process.enabled}
            disabled={pending || missing || (noTimetable && !process.enabled)}
            label={`${process.enabled ? "Turn off" : "Turn on"} ${process.name}`}
            title={noTimetable ? "Give it a timetable first" : undefined}
            onChange={(on) =>
              act(() => switchProcess(spaceSlug, appSlug, process.name, on))
            }
          />
        </span>
      </div>

      {error !== null ? (
        <p role="alert" className="enter-fade mt-2 text-[12px] text-failed">
          {error}
        </p>
      ) : notice !== null ? (
        <p role="status" className="enter-fade mt-2 text-[12px] text-ink-muted">
          {notice}
        </p>
      ) : null}

      {editing ? (
        <TimetableEditor
          process={process}
          pending={pending}
          onCancel={() => setEditing(false)}
          onSave={(schedule, minutes) =>
            act(() =>
              scheduleProcess(spaceSlug, appSlug, process.name, schedule, minutes),
            )
          }
        />
      ) : null}

      {process.state?.kind === "scheduled" && process.state.runs.length > 0 ? (
        <ol className="mt-3 border-t border-line pt-2">
          {process.state.runs.map((run) => (
            <li key={run.id} className="flex items-center gap-3 py-1 text-[12px]">
              <time
                dateTime={new Date(run.startedAt).toISOString()}
                className="tabular w-[128px] shrink-0 text-ink-subtle"
              >
                {when(new Date(run.startedAt))}
              </time>
              <span
                className={`w-[76px] shrink-0 ${
                  run.outcome === "succeeded"
                    ? "text-live"
                    : run.outcome === "failed"
                      ? "text-failed"
                      : "text-ink-muted"
                }`}
              >
                {OUTCOME[run.outcome]}
              </span>
              <span className="tabular min-w-0 flex-1 text-ink-subtle">
                {run.finishedAt === null
                  ? ""
                  : took(new Date(run.startedAt), new Date(run.finishedAt))}
              </span>
              <SectionLink
                href={`${logsHref}&around=${encodeURIComponent(new Date(run.startedAt).toISOString())}`}
              >
                Logs
              </SectionLink>
            </li>
          ))}
        </ol>
      ) : null}
    </li>
  );
}

function Status({ process, missing }: { process: ProcessView; missing: boolean }) {
  if (missing) {
    return <span className="text-pending">Not created yet. Deploy the app again.</span>;
  }
  if (!process.enabled) return <span className="text-ink-subtle">Off</span>;
  if (process.kind === "worker") {
    const health = process.state?.kind === "worker" ? process.state.health : null;
    if (health === "failed") return <span className="text-failed">Failed to start</span>;
    if (health === "starting") return <span className="text-pending">Starting</span>;
    return <span className="text-live">Running</span>;
  }
  return <span className="text-live">On · up to {process.timeoutMinutes} min a run</span>;
}

function Kind({ kind }: { kind: "web" | "worker" | "scheduled" }) {
  return (
    <span className="rounded-[2px] border border-line bg-sunken px-1.5 py-px text-[9.5px] font-semibold tracking-[0.08em] text-ink-subtle uppercase">
      {kind === "web" ? "Web" : kind === "worker" ? "Worker" : "Scheduled"}
    </span>
  );
}

function Switch({
  on,
  disabled,
  label,
  title,
  onChange,
}: {
  on: boolean;
  disabled: boolean;
  label: string;
  title?: string | undefined;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-[18px] w-[32px] sm:ml-1 shrink-0 rounded-full transition-colors duration-150 disabled:opacity-40 ${
        on ? "bg-live/70" : "bg-line-strong"
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-[2px] h-[14px] w-[14px] rounded-full transition-[left] duration-200 ease-[var(--ease-spring)] ${
          on ? "left-[16px] bg-white" : "left-[2px] bg-ink-subtle"
        }`}
      />
    </button>
  );
}

const PRESETS: Array<{ label: string; schedule: string }> = [
  { label: "Every hour", schedule: "0 * * * *" },
  { label: "Every day at 06:00", schedule: "0 6 * * *" },
  { label: "Weekdays at 09:00", schedule: "0 9 * * 1-5" },
  { label: "Mondays at 09:00", schedule: "0 9 * * 1" },
];

/**
 * A timetable, written the way it is stored - five-field cron in UTC - with
 * the common ones a click away and what was typed said back in words as it is
 * typed, so nobody has to read cron to know what they set.
 */
function TimetableEditor({
  process,
  pending,
  onCancel,
  onSave,
}: {
  process: ProcessView;
  pending: boolean;
  onCancel: () => void;
  onSave: (schedule: string, minutes: number | null) => void;
}) {
  const [schedule, setSchedule] = useState(process.schedule ?? "0 6 * * *");
  const [minutes, setMinutes] = useState(
    process.requestedTimeoutMinutes === null
      ? ""
      : String(process.requestedTimeoutMinutes),
  );
  const parsed = parseSchedule(schedule);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(schedule, minutes.trim() === "" ? null : Number(minutes));
      }}
      className="enter-up mt-3 rounded-[var(--radius-edge)] border border-line bg-sunken/40 p-3.5"
    >
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((preset) => (
          <button
            key={preset.schedule}
            type="button"
            onClick={() => setSchedule(preset.schedule)}
            aria-pressed={schedule === preset.schedule}
            className={`rounded-[var(--radius-edge)] border px-2 py-1 text-[11.5px] transition-colors duration-150 ${
              schedule === preset.schedule
                ? "border-line-strong bg-surface text-ink"
                : "border-line text-ink-muted hover:text-ink"
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px]">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[12px] text-ink-muted">Timetable (cron, UTC)</span>
          <input
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            maxLength={100}
            className="field py-2 font-mono text-[12.5px]"
          />
          <span
            className={`text-[11.5px] ${parsed.ok ? "text-ink-subtle" : "text-failed"}`}
          >
            {parsed.ok ? describeSchedule(parsed.schedule) : parsed.error}
          </span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] text-ink-muted">Minutes a run</span>
          <input
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            inputMode="numeric"
            placeholder="10"
            className="field py-2 text-[12.5px]"
          />
          <span className="text-[11.5px] text-ink-subtle">
            Always stopped before its next run.
          </span>
        </label>
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="btn btn-ghost px-2.5 py-1.5 text-[12px]"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending || !parsed.ok}
          className="btn btn-primary px-3 py-1.5 text-[12px]"
        >
          {pending ? "Saving..." : "Save timetable"}
        </button>
      </div>
    </form>
  );
}

const OUTCOME: Record<"running" | "succeeded" | "failed" | "cancelled", string> = {
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
};

function when(at: Date): string {
  return at.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function took(from: Date, to: Date): string {
  const seconds = Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

function ahead(at: Date): string {
  const minutes = Math.round((at.getTime() - Date.now()) / 60_000);
  if (minutes < 1) return "in under a minute";
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours} h`;
  return `in ${Math.round(hours / 24)} days`;
}
