"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_LIMITS } from "@cira/core/limits";
import { crashCount, describeMemory } from "@cira/core/processes";
import { describeSchedule, parseSchedule } from "@cira/core/schedule";
import type { ProcessView } from "@/lib/processes";
import {
  runProcessNow,
  scheduleProcess,
  setProcessMemory,
  switchProcess,
} from "@/lib/process-actions";
import { SectionLink } from "./section-link";
import { LocalTime } from "@/components/local-time";

/**
 * What an app runs besides serving requests: its workers and scheduled runs.
 *
 * Found in the repository when it was deployed, and all off until someone who
 * manages the app turns them on - they run code nobody is watching, and a
 * worker costs money every hour it is on. Each says whether it is on and what
 * happened last, to anyone who can open the app; what it runs, its logs and
 * its controls only to those who manage it.
 */

/** The memory sizes offered, smallest first. */
const MEMORY_CHOICES = DEFAULT_LIMITS.processes.memoryChoicesMiB;

/** The next size up, or null at the largest. */
function roomier(memoryMiB: number): number | null {
  return MEMORY_CHOICES.find((c) => c > memoryMiB) ?? null;
}

export function ProcessPanel({
  processes,
  spaceSlug,
  appSlug,
  canManage,
  logsHref,
  servesWeb,
  workerPrice,
}: {
  processes: ProcessView[];
  spaceSlug: string;
  appSlug: string;
  /** Whether to offer the switches, timetables and Run now. */
  canManage: boolean;
  /** Null for anyone who cannot read the app's logs. */
  logsHref: string | null;
  /** Whether the app also has a web process, to list it for the whole picture. */
  servesWeb: boolean;
  /**
   * What a worker is billed at a month on the Team plan, and how many this
   * space's plan includes - never what one costs Cira to run, which is a
   * different and smaller number.
   */
  workerPrice: { monthly: number; included: number };
}) {
  if (processes.length === 0) return null;
  const workers = processes.filter((p) => p.kind === "worker").length;

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
            canManage={canManage}
            logsHref={
              logsHref === null
                ? null
                : `${logsHref}?process=${encodeURIComponent(process.name)}`
            }
          />
        ))}
      </ul>

      {workers > 0 && canManage ? (
        <p className="mt-2 text-[11.5px] text-ink-subtle">
          {workerPrice.included > 0
            ? `A worker runs all the time. The trial includes ${workerPrice.included === 1 ? "one" : workerPrice.included}; on the Team plan each is $${workerPrice.monthly} a month while it is on.`
            : `A worker runs all the time, and is billed at $${workerPrice.monthly} a month while it is on, whatever its memory.`}
        </p>
      ) : null}
    </section>
  );
}

function Row({
  process,
  spaceSlug,
  appSlug,
  canManage,
  logsHref,
}: {
  process: ProcessView;
  spaceSlug: string;
  appSlug: string;
  canManage: boolean;
  logsHref: string | null;
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
  const more = roomier(process.memoryMiB);
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
          {process.command !== null ? (
            <span className="mt-1 block truncate font-mono text-[11.5px] text-ink-subtle">
              {process.command}
            </span>
          ) : null}
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
                      · next <LocalTime at={process.nextRunAt} as="ahead" />
                    </span>
                  ) : null}
                </span>
              )
            ) : null}
            <span className="text-ink-subtle">
              {describeMemory(process.memoryMiB)} memory
            </span>
            <span className="text-ink-subtle">from {process.source}</span>
            {process.kind === "worker" && !missing && logsHref !== null ? (
              <SectionLink href={logsHref}>Logs</SectionLink>
            ) : null}
          </span>
        </span>

        {canManage ? (
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
              </>
            ) : null}
            <button
              type="button"
              disabled={pending || missing}
              onClick={() => {
                setEditing((open) => !open);
                setError(null);
              }}
              aria-expanded={editing}
              className="btn btn-secondary px-2.5 py-1.5 text-[12px]"
            >
              {noTimetable ? "Set a timetable" : "Edit"}
            </button>
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
        ) : null}
      </div>

      {process.crashes !== null && process.enabled && !missing ? (
        <p className="mt-2 text-[12px] text-failed">
          Exited {crashCount(process.crashes)}, last at{" "}
          <LocalTime at={process.crashes.lastAt} />, and was started again each time.{" "}
          <span className="text-ink-muted">
            A worker should run for good; its logs say why it stops.
          </span>
        </p>
      ) : null}
      {process.outOfMemoryAt !== null && !missing ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px]">
          <p className="text-failed">
            {process.kind === "worker" ? (
              <>
                Ran out of memory <LocalTime at={process.outOfMemoryAt} /> and was
                restarted.
              </>
            ) : (
              "Its last run ran out of memory."
            )}{" "}
            <span className="text-ink-muted">
              {more === null
                ? `${describeMemory(process.memoryMiB)} is the most Cira gives; the work needs to use less.`
                : `It needs more than ${describeMemory(process.memoryMiB)}.`}
            </span>
          </p>
          {canManage && more !== null ? (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                act(
                  () => setProcessMemory(spaceSlug, appSlug, process.name, more),
                  `Now ${describeMemory(more)}.`,
                )
              }
              className="btn btn-secondary px-2.5 py-1 text-[12px]"
            >
              Give it {describeMemory(more)}
            </button>
          ) : null}
        </div>
      ) : null}

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
        <ProcessEditor
          process={process}
          pending={pending}
          onCancel={() => setEditing(false)}
          onSave={({ schedule, minutes, memoryMiB }) =>
            act(async () => {
              if (memoryMiB !== process.memoryMiB) {
                const set = await setProcessMemory(
                  spaceSlug,
                  appSlug,
                  process.name,
                  memoryMiB,
                );
                if (!set.ok) return set;
              }
              const retimed =
                schedule !== null &&
                (schedule !== process.schedule ||
                  minutes !== process.requestedTimeoutMinutes);
              return retimed
                ? scheduleProcess(spaceSlug, appSlug, process.name, schedule, minutes)
                : { ok: true };
            })
          }
        />
      ) : null}

      {process.state?.kind === "scheduled" && process.state.runs.length > 0 ? (
        <ol className="mt-3 border-t border-line pt-2">
          {process.state.runs.map((run) => (
            <li
              key={run.id}
              className="flex items-center gap-2 py-1 text-[12px] sm:gap-3"
            >
              <time
                dateTime={new Date(run.startedAt).toISOString()}
                className="tabular w-[82px] shrink-0 text-ink-subtle sm:w-[128px]"
              >
                <LocalTime at={run.startedAt} />
              </time>
              <span
                title={run.outOfMemory ? "Ran out of memory" : undefined}
                className={`w-[64px] shrink-0 sm:w-[76px] ${
                  run.outcome === "succeeded"
                    ? "text-live"
                    : run.outcome === "failed"
                      ? "text-failed"
                      : "text-ink-muted"
                }`}
              >
                {OUTCOME[run.outcome]}
              </span>
              <span className="tabular min-w-0 flex-1 truncate whitespace-nowrap text-ink-subtle">
                {run.finishedAt === null
                  ? ""
                  : took(new Date(run.startedAt), new Date(run.finishedAt))}
              </span>
              {logsHref !== null ? (
                <SectionLink
                  href={`${logsHref}&around=${encodeURIComponent(new Date(run.startedAt).toISOString())}`}
                >
                  Logs
                </SectionLink>
              ) : null}
            </li>
          ))}
        </ol>
      ) : process.kind === "scheduled" && process.state === null && !missing ? (
        <p className="mt-2 text-[12px] text-ink-subtle">
          Could not check its recent runs just now.
        </p>
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
    if (health === null) {
      return <span className="text-ink-muted">On · could not check just now</span>;
    }
    if (health === "failed") return <span className="text-failed">Failed to start</span>;
    if (health === "starting") return <span className="text-pending">Starting</span>;
    // Exiting on its own and being started again, over and over.
    if (process.crashes !== null) {
      return <span className="text-failed">Keeps stopping</span>;
    }
    // Up again now, but it has been killed for memory lately and will be again.
    if (process.outOfMemoryAt !== null) {
      return <span className="text-pending">Restarted</span>;
    }
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

/**
 * On is green, off is a plain track with the same white knob. Off has to read
 * as "can be switched on", not as locked: a grey knob on a grey track is how
 * a disabled control looks, and was mistaken for one. Only a switch that
 * really cannot be used - a scheduled run with no timetable - is faded.
 */
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
      className={`group relative h-[20px] w-[36px] shrink-0 cursor-pointer rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 sm:ml-1 ${
        on
          ? "bg-live"
          : "bg-line-strong shadow-[inset_0_0_0_1px_var(--color-line-strong)] enabled:hover:bg-ink-subtle/60"
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-[2px] h-[16px] w-[16px] rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.35)] transition-[left] duration-200 ease-[var(--ease-spring)] ${
          on ? "left-[18px]" : "left-[2px]"
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
 * How a process runs: for a scheduled run, its timetable, written the way it
 * is stored - five-field cron in UTC - with the common ones a click away and
 * what was typed said back in words as it is typed, so nobody has to read
 * cron to know what they set; for either kind, its memory, with what a worker
 * would cost a month at each size.
 */
function ProcessEditor({
  process,
  pending,
  onCancel,
  onSave,
}: {
  process: ProcessView;
  pending: boolean;
  onCancel: () => void;
  onSave: (changes: {
    schedule: string | null;
    minutes: number | null;
    memoryMiB: number;
  }) => void;
}) {
  const scheduled = process.kind === "scheduled";
  const [schedule, setSchedule] = useState(process.schedule ?? "0 6 * * *");
  const [minutes, setMinutes] = useState(
    process.requestedTimeoutMinutes === null
      ? ""
      : String(process.requestedTimeoutMinutes),
  );
  const [memoryMiB, setMemoryMiB] = useState(process.memoryMiB);
  const parsed = parseSchedule(schedule);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          schedule: scheduled ? schedule : null,
          minutes: minutes.trim() === "" ? null : Number(minutes),
          memoryMiB,
        });
      }}
      className="enter-up mt-3 rounded-[var(--radius-edge)] border border-line bg-sunken/40 p-3.5"
    >
      {scheduled ? (
        <>
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
        </>
      ) : null}

      <fieldset className={scheduled ? "mt-3" : ""}>
        <legend className="text-[12px] text-ink-muted">Memory</legend>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {MEMORY_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => setMemoryMiB(choice)}
              aria-pressed={memoryMiB === choice}
              className={`tabular rounded-[var(--radius-edge)] border px-2.5 py-1 text-[11.5px] transition-colors duration-150 ${
                memoryMiB === choice
                  ? "border-line-strong bg-surface text-ink"
                  : "border-line text-ink-muted hover:text-ink"
              }`}
            >
              {describeMemory(choice)}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11.5px] text-ink-subtle">
          {scheduled
            ? "Given to each run. It only costs anything while a run is going."
            : "The worker's price is the same whatever memory it has."}
        </p>
      </fieldset>

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
          disabled={pending || (scheduled && !parsed.ok)}
          className="btn btn-primary px-3 py-1.5 text-[12px]"
        >
          {pending ? "Saving..." : "Save"}
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

function took(from: Date, to: Date): string {
  const seconds = Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
