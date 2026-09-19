"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  consoleAffordance,
  fillTargetPath,
  formFor,
  readForm,
  readJsonInput,
  type CapabilityForm,
  type CapabilityReach,
  type CapabilityRisk,
  type ConsoleAffordance,
  type FormField,
  type JsonSchema,
} from "@cira/core";
import { validateInput } from "@/lib/json-schema";
import { runCapability, type ConsoleRun } from "@/lib/console-actions";
import { SectionLink } from "./section-link";

/**
 * The capability console: an app's capabilities, each one a form.
 *
 * The deterministic way in. Ask Cira is for someone who does not know what an
 * app can do; this is for someone who knows exactly which call they want and
 * wants to see the literal input before anything is sent - the developer
 * checking an endpoint after a deploy, the person who runs the same report
 * every Monday and would rather not have a model in between.
 *
 * Everything the page decides - what can run, what a schema becomes - comes
 * from `@cira/core`, and everything that matters is decided again on the
 * server, which trusts none of it. Runs are kept in this component's memory
 * and nowhere else: a reply can hold anything the app returns, and Cira passes
 * it through rather than keeping it.
 */

export interface ConsoleEntry {
  id: string;
  name: string;
  description: string;
  method: string;
  path: string;
  risk: CapabilityRisk;
  reach: CapabilityReach;
  enabled: boolean;
  inputSchema: JsonSchema;
  example: Record<string, unknown> | null;
}

type Values = Record<string, string | boolean | string[]>;

interface Run {
  id: number;
  capabilityId: string;
  input: Record<string, unknown>;
  at: Date;
  /** Measured here, for when the app was never reached and so timed nothing. */
  roundTripMs: number | null;
  result: ConsoleRun | null;
}

export function CapabilityConsole({
  entries,
  appName,
  running,
  initial,
  logsHref,
}: {
  entries: ConsoleEntry[];
  appName: string;
  /** Whether the app's newest deployment is live, so a run can reach it. */
  running: boolean;
  /** The capability named in the address, if any. */
  initial: string | null;
  /** The app's runtime logs, for whoever manages it; null for everyone else. */
  logsHref: string | null;
}) {
  const reads = entries.filter((e) => e.risk === "read");
  const writes = entries.filter((e) => e.risk === "write");

  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const named = entries.find((e) => e.name === initial);
    if (named !== undefined) return named.id;
    const runnable = [...reads, ...writes].find(
      (e) => consoleAffordance(e).kind === "run",
    );
    return (runnable ?? reads[0] ?? writes[0])?.id ?? null;
  });
  const [runs, setRuns] = useState<Run[]>([]);
  const runner = useRef<HTMLDivElement>(null);

  const selected = entries.find((e) => e.id === selectedId) ?? null;

  const select = (entry: ConsoleEntry) => {
    setSelectedId(entry.id);
    // The address names the capability so a link can open it - and, later,
    // carry an input to start the form from. Replaced rather than pushed: a
    // back button that steps through every row somebody clicked is noise.
    const url = new URL(window.location.href);
    url.searchParams.set("capability", entry.name);
    window.history.replaceState(null, "", url);

    // Stacked on a narrow screen, the runner is below the list; follow it.
    const box = runner.current;
    if (box !== null && box.getBoundingClientRect().top > window.innerHeight * 0.6) {
      box.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[272px_minmax(0,1fr)] lg:items-start">
      <nav aria-label="Capabilities" className="flex min-w-0 flex-col gap-4">
        <ListGroup
          title="Reads"
          note="Run when you press Run"
          entries={reads}
          selectedId={selectedId}
          onSelect={select}
        />
        <ListGroup
          title="Writes"
          note="Ask before they run"
          entries={writes}
          selectedId={selectedId}
          onSelect={select}
        />
      </nav>

      <div ref={runner} className="min-w-0 scroll-mt-4">
        {selected !== null ? (
          <Runner
            // A fresh runner per capability, so one's half-typed input and
            // pending confirmation never leak into another's form.
            key={selected.id}
            entry={selected}
            appName={appName}
            running={running}
            logsHref={logsHref}
            runs={runs.filter((r) => r.capabilityId === selected.id)}
            onRun={(run) => setRuns((all) => [run, ...all])}
            onResult={(id, patch) =>
              setRuns((all) => all.map((r) => (r.id === id ? { ...r, ...patch } : r)))
            }
          />
        ) : null}
      </div>
    </div>
  );
}

function ListGroup({
  title,
  note,
  entries,
  selectedId,
  onSelect,
}: {
  title: string;
  note: string;
  entries: ConsoleEntry[];
  selectedId: string | null;
  onSelect: (entry: ConsoleEntry) => void;
}) {
  if (entries.length === 0) return null;

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 px-0.5">
        <p className="eyebrow">{title}</p>
        <p className="text-[11px] text-ink-subtle">{note}</p>
      </div>
      <ul className="mt-2 divide-y divide-line overflow-hidden rounded-[var(--radius-edge)] border border-line bg-surface">
        {entries.map((entry) => {
          const affordance = consoleAffordance(entry);
          const current = entry.id === selectedId;
          return (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => onSelect(entry)}
                aria-current={current ? "true" : undefined}
                className={`relative flex w-full min-w-0 items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors duration-150 ${
                  current ? "bg-sunken/70" : "hover:bg-sunken/40"
                }`}
              >
                {current ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 left-0 w-[2px] bg-accent"
                  />
                ) : null}
                <Method method={entry.method} />
                <span
                  className={`min-w-0 flex-1 truncate font-mono text-[12.5px] ${
                    affordance.kind === "run" ? "text-ink" : "text-ink-muted"
                  }`}
                >
                  {entry.name}
                </span>
                <StateMark affordance={affordance} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Method({ method }: { method: string }) {
  return (
    <span className="w-9 shrink-0 font-mono text-[10px] font-semibold tracking-[0.04em] text-ink-subtle">
      {method}
    </span>
  );
}

/** A word for anything that cannot run, and nothing for what can. */
function StateMark({ affordance }: { affordance: ConsoleAffordance }) {
  if (affordance.kind === "run") return null;
  const word =
    affordance.kind === "off"
      ? "Off"
      : affordance.kind === "refused"
        ? "Refused"
        : "Checking";
  return <span className="shrink-0 text-[11px] text-ink-subtle">{word}</span>;
}

function Runner({
  entry,
  appName,
  running,
  logsHref,
  runs,
  onRun,
  onResult,
}: {
  entry: ConsoleEntry;
  appName: string;
  running: boolean;
  logsHref: string | null;
  runs: Run[];
  onRun: (run: Run) => void;
  onResult: (id: number, patch: Partial<Run>) => void;
}) {
  const router = useRouter();
  const affordance = consoleAffordance(entry);
  const form = useMemo(
    () => formFor(entry.inputSchema, entry.example),
    [entry.inputSchema, entry.example],
  );
  const [values, setValues] = useState<Values>(() => startingValues(form));
  const [json, setJsonText] = useState(form.kind === "json" ? form.initial : "");
  const [problem, setProblem] = useState<{ field: string | null; error: string } | null>(
    null,
  );
  const [confirming, setConfirming] = useState<Record<string, unknown> | null>(null);
  const [shownRunId, setShownRunId] = useState<number | null>(null);
  const busy = runs.some((r) => r.result === null);
  const runnable = affordance.kind === "run";

  const shown = runs.find((r) => r.id === shownRunId) ?? runs[0] ?? null;

  // The confirmation is a question about one exact input. Editing the form
  // while it is open makes it a question about something else, so any edit
  // takes it away.
  const setField = (name: string, value: string | boolean | string[]) => {
    setConfirming(null);
    setValues((v) => ({ ...v, [name]: value }));
  };
  const setJson = (text: string) => {
    setConfirming(null);
    setJsonText(text);
  };

  const collect = (): Record<string, unknown> | null => {
    const read =
      form.kind === "fields"
        ? readForm(form.fields, values)
        : { ...readJsonInput(json), field: null };
    if (!read.ok) {
      setProblem({ field: read.field, error: read.error });
      return null;
    }
    // The same check the server makes, for an answer before the round trip.
    // It is only that: the server makes it again and takes nothing from here.
    const checked = validateInput(entry.inputSchema, read.input);
    if (!checked.ok) {
      setProblem({ field: null, error: capitalise(checked.error) });
      return null;
    }
    setProblem(null);
    return checked.value;
  };

  const send = async (input: Record<string, unknown>) => {
    setConfirming(null);
    const id = ++lastRunId;
    const started = performance.now();
    onRun({
      id,
      capabilityId: entry.id,
      input,
      at: new Date(),
      roundTripMs: null,
      result: null,
    });
    setShownRunId(id);

    let result: ConsoleRun;
    try {
      result = await runCapability(entry.id, input);
    } catch {
      result = { ok: false, error: "Could not reach Cira. Try again.", answer: null };
    }
    onResult(id, { result, roundTripMs: Math.round(performance.now() - started) });

    // A write the app turned away is recorded as refused; show that now
    // rather than leave a Run button that leads to the same wall.
    if (result.answer?.status === 401) router.refresh();
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!runnable || busy) return;
    const input = collect();
    if (input === null) return;
    if (entry.risk === "write") setConfirming(input);
    else void send(input);
  };

  return (
    <section
      aria-labelledby="runner-name"
      className="enter-fade overflow-hidden rounded-[var(--radius-edge)] border border-line bg-surface"
    >
      <header className="border-b border-line px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <h2
            id="runner-name"
            className="min-w-0 font-mono text-[14px] font-semibold tracking-[-0.01em] break-all text-ink"
          >
            {entry.name}
          </h2>
          <RiskMark risk={entry.risk} />
        </div>
        <p className="mt-1.5 font-mono text-[12px] break-all text-ink-muted">
          <span className="font-semibold text-ink-subtle">{entry.method}</span>{" "}
          {entry.path}
        </p>
        {/*
          Plain text, always. The description was written by a model reading
          the app's source, and a repository can put anything in a comment -
          so it goes in as a string for React to escape, and is never parsed
          as markdown or handed to anything that would render HTML.
        */}
        {entry.description.trim() !== "" ? (
          <p className="mt-2.5 text-[13px] leading-relaxed whitespace-pre-line text-ink-muted">
            {entry.description}
          </p>
        ) : null}
      </header>

      {affordance.kind !== "run" ? (
        <Notice affordance={affordance} />
      ) : !running ? (
        <p className="border-b border-line bg-sunken/40 px-5 py-3 text-[12.5px] text-ink-muted">
          {appName} is not running right now, so a run will not reach it.
        </p>
      ) : null}

      <form onSubmit={submit} noValidate className="px-5 py-4">
        <fieldset disabled={!runnable} className="min-w-0 disabled:opacity-60">
          <legend className="eyebrow">Input</legend>
          {form.kind === "fields" ? (
            form.fields.length === 0 ? (
              <p className="mt-2.5 text-[12.5px] text-ink-subtle">This takes no input.</p>
            ) : (
              <div className="mt-3 grid gap-x-4 gap-y-3.5 sm:grid-cols-2">
                {form.fields.map((field) => (
                  <Field
                    key={field.name}
                    field={field}
                    value={values[field.name]}
                    error={problem?.field === field.name ? problem.error : null}
                    onChange={(value) => setField(field.name, value)}
                  />
                ))}
              </div>
            )
          ) : (
            <JsonInput form={form} value={json} onChange={setJson} />
          )}
        </fieldset>

        {problem !== null && problem.field === null ? (
          <p role="alert" className="enter-fade mt-3 text-[12.5px] text-failed">
            {problem.error}
          </p>
        ) : null}

        {/* Nothing to press when nothing can run: the notice above says why,
            and a dimmed button beneath it only invites the click. */}
        {!runnable ? null : confirming === null ? (
          <div className="mt-4 flex items-center gap-3">
            <button type="submit" disabled={busy} className="btn btn-primary">
              {busy ? "Running..." : entry.risk === "write" ? "Review" : "Run"}
            </button>
            {entry.risk === "write" ? (
              <p className="text-[12px] text-ink-subtle">
                You will see exactly what is sent before it runs.
              </p>
            ) : null}
          </div>
        ) : (
          <Confirm
            entry={entry}
            appName={appName}
            input={confirming}
            onCancel={() => setConfirming(null)}
            onConfirm={() => void send(confirming)}
          />
        )}
      </form>

      {shown !== null ? (
        <Result
          run={shown}
          history={runs}
          onShow={(id) => setShownRunId(id)}
          logsHref={
            logsHref === null
              ? null
              : `${logsHref}?${new URLSearchParams({
                  around: shown.at.toISOString(),
                  capability: entry.name,
                }).toString()}`
          }
        />
      ) : null}
    </section>
  );
}

/** Why this one cannot run, stated plainly. A refusal is not an error. */
function Notice({
  affordance,
}: {
  affordance: Exclude<ConsoleAffordance, { kind: "run" }>;
}) {
  return (
    <p className="flex items-start gap-2.5 border-b border-line bg-sunken/40 px-5 py-3 text-[12.5px] leading-relaxed text-ink-muted">
      <span
        aria-hidden="true"
        className={`mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full ${
          affordance.kind === "pending"
            ? "ping relative bg-pending text-pending"
            : "bg-ink-subtle"
        }`}
      />
      {affordance.reason}
    </p>
  );
}

function Field({
  field,
  value,
  error,
  onChange,
}: {
  field: FormField;
  value: string | boolean | string[] | undefined;
  error: string | null;
  onChange: (value: string | boolean | string[]) => void;
}) {
  const id = `field-${field.name}`;
  const described = [
    field.description !== null ? `${id}-about` : null,
    error !== null ? `${id}-error` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const shared = {
    id,
    name: field.name,
    "aria-invalid": error !== null ? true : undefined,
    "aria-describedby": described === "" ? undefined : described,
    className: `field py-2 text-[13px] ${error !== null ? "field-danger border-failed/60" : ""}`,
  };

  const label = (
    <span className="flex items-baseline gap-1.5">
      <span className="font-mono text-[12px] text-ink">{field.name}</span>
      {field.required ? (
        <span className="text-[11px] text-ink-subtle">required</span>
      ) : null}
    </span>
  );

  const about =
    field.description !== null ? (
      <span id={`${id}-about`} className="text-[11.5px] leading-snug text-ink-subtle">
        {field.description}
      </span>
    ) : null;

  const problem =
    error !== null ? (
      <span id={`${id}-error`} role="alert" className="text-[11.5px] text-failed">
        {error}
      </span>
    ) : null;

  if (field.kind === "checkbox") {
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <label className="flex items-center gap-2.5 py-1.5">
          <input
            type="checkbox"
            id={id}
            name={field.name}
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-accent)]"
          />
          {label}
        </label>
        {about}
        {problem}
      </div>
    );
  }

  if (field.kind === "list") {
    const items = Array.isArray(value) && value.length > 0 ? value : [""];
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <span id={`${id}-label`}>{label}</span>
        {about}
        <div
          role="group"
          aria-labelledby={`${id}-label`}
          className="flex flex-col gap-1.5"
        >
          {items.map((item, index) => (
            <div key={index} className="flex gap-1.5">
              <input
                type={field.item === "string" ? "text" : "number"}
                aria-label={`${field.name} ${index + 1}`}
                value={item}
                onChange={(e) =>
                  onChange(items.map((v, i) => (i === index ? e.target.value : v)))
                }
                className={shared.className}
              />
              <button
                type="button"
                aria-label={`Remove ${field.name} ${index + 1}`}
                onClick={() => onChange(items.filter((_, i) => i !== index))}
                disabled={items.length === 1 && item === ""}
                className="btn btn-ghost shrink-0 px-2"
              >
                <svg
                  viewBox="0 0 12 12"
                  aria-hidden="true"
                  className="h-3 w-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                >
                  <path d="M3 3l6 6M9 3l-6 6" />
                </svg>
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onChange([...items, ""])}
          className="btn btn-ghost -ml-2 self-start px-2 py-1 text-[12px]"
        >
          Add another
        </button>
        {problem}
      </div>
    );
  }

  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      {label}
      {field.kind === "select" ? (
        <select
          {...shared}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        >
          {field.required && typeof value === "string" && value !== "" ? null : (
            <option value="">{field.required ? "Choose one" : "Not set"}</option>
          )}
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          {...shared}
          type={
            field.kind === "date" ? "date" : field.kind === "number" ? "number" : "text"
          }
          inputMode={
            field.kind === "number" ? (field.integer ? "numeric" : "decimal") : undefined
          }
          step={field.kind === "number" ? (field.integer ? 1 : "any") : undefined}
          spellCheck={false}
          autoComplete="off"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {about}
      {problem}
    </label>
  );
}

function JsonInput({
  form,
  value,
  onChange,
}: {
  form: Extract<CapabilityForm, { kind: "json" }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      <textarea
        aria-label="Input as JSON"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        rows={Math.min(14, Math.max(4, value.split("\n").length + 1))}
        className="field resize-y font-mono text-[12.5px] leading-relaxed"
      />
      <p className="text-[11.5px] text-ink-subtle">
        Written as JSON: {lower(form.reason)}
      </p>
    </div>
  );
}

/**
 * The last step before a write: exactly what goes where.
 *
 * Built from the validated input - what the server will send, after anything
 * the schema does not describe has been dropped - and split the way the call
 * splits it, so a value that goes into the address is shown there.
 */
function Confirm({
  entry,
  appName,
  input,
  onCancel,
  onConfirm,
}: {
  entry: ConsoleEntry;
  appName: string;
  input: Record<string, unknown>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const filled = fillTargetPath(entry.path, input);
  const body = Object.fromEntries(
    Object.entries(input).filter(([key]) => !filled.used.includes(key)),
  );
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => confirm.current?.focus(), []);

  return (
    <div
      role="group"
      aria-label="Confirm this run"
      className="enter-up mt-4 overflow-hidden rounded-[var(--radius-edge)] border border-pending/40 bg-pending/[0.06]"
    >
      <div className="px-4 py-3">
        <p className="text-[13px] font-medium text-ink">
          This changes something in {appName}.
        </p>
        <p className="mt-0.5 text-[12px] text-ink-muted">
          It sends this, once, as soon as you confirm.
        </p>
      </div>
      <div className="border-t border-pending/25 bg-surface/60 px-4 py-3 font-mono text-[12px] leading-relaxed">
        <p className="break-all text-ink">
          <span className="font-semibold text-ink-subtle">{entry.method}</span>{" "}
          {filled.path}
        </p>
        <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-words text-ink-muted">
          {JSON.stringify(body, null, 2)}
        </pre>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-pending/25 px-4 py-2.5">
        <button type="button" onClick={onCancel} className="btn btn-ghost">
          Cancel
        </button>
        <button
          ref={confirm}
          type="button"
          onClick={onConfirm}
          className="btn btn-primary"
        >
          Run {entry.name}
        </button>
      </div>
    </div>
  );
}

function Result({
  run,
  history,
  onShow,
  logsHref,
}: {
  run: Run;
  history: Run[];
  onShow: (id: number) => void;
  /** The app's logs around this run, for whoever may read them. */
  logsHref: string | null;
}) {
  const [raw, setRaw] = useState(false);
  const [copied, setCopied] = useState(false);
  const answer = run.result?.answer ?? null;
  const pretty = answer === null ? null : prettyJson(answer.body);
  const body = answer === null ? "" : raw || pretty === null ? answer.body : pretty;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Nothing to do; the text is on screen to select by hand.
    }
  };

  return (
    <div className="border-t border-line" aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 pt-4">
        <p className="eyebrow">Result</p>
        {run.result === null ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-muted">
            <span
              aria-hidden="true"
              className="ping relative h-[5px] w-[5px] rounded-full bg-pending text-pending"
            />
            Running
          </span>
        ) : answer !== null ? (
          <>
            <Status status={answer.status} />
            <span className="tabular text-[12px] text-ink-subtle">
              {duration(answer.elapsedMs)}
            </span>
          </>
        ) : (
          <span className="text-[12px] text-failed">Not run</span>
        )}

        {/* A failure is when someone wants to know why, and the app's own
            account of it is in its logs, around this moment. */}
        {run.result !== null && !run.result.ok && logsHref !== null ? (
          <SectionLink href={logsHref}>See logs from this run</SectionLink>
        ) : null}

        {answer !== null && answer.body !== "" ? (
          <div className="ml-auto flex items-center gap-1">
            {pretty !== null ? (
              <div
                role="group"
                aria-label="Body format"
                className="inline-flex rounded-[var(--radius-edge)] border border-line p-0.5"
              >
                {(["Pretty", "Raw"] as const).map((mode) => {
                  const on = (mode === "Raw") === raw;
                  return (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setRaw(mode === "Raw")}
                      className={`rounded-[2px] px-2 py-0.5 text-[11.5px] transition-colors duration-150 ${
                        on ? "bg-sunken text-ink" : "text-ink-subtle hover:text-ink"
                      }`}
                    >
                      {mode}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => void copy()}
              className="btn btn-ghost px-2 py-1 text-[11.5px]"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        ) : null}
      </div>

      {run.result !== null &&
      run.result.error !== null &&
      (answer === null || answer.status === 401) ? (
        <p
          role="alert"
          className="enter-fade px-5 pt-2.5 text-[12.5px] leading-relaxed text-ink-muted"
        >
          {run.result.error}
        </p>
      ) : null}

      {answer !== null ? (
        answer.body === "" ? (
          <p className="px-5 pt-2.5 pb-4 text-[12.5px] text-ink-subtle">
            The app sent back no body.
          </p>
        ) : (
          <pre
            tabIndex={0}
            aria-label="Response body"
            className="mx-5 mt-3 mb-4 max-h-[440px] overflow-auto rounded-[var(--radius-edge)] border border-line bg-sunken/50 px-3.5 py-3 font-mono text-[12px] leading-relaxed whitespace-pre text-ink"
          >
            {raw || pretty === null ? body : <Highlighted json={body} />}
          </pre>
        )
      ) : (
        <div className="pb-4" />
      )}

      {history.length > 1 ? (
        <div className="border-t border-line px-5 py-3">
          <p className="eyebrow">This session</p>
          <ul className="mt-2 flex flex-col">
            {history.map((past) => (
              <li key={past.id}>
                <button
                  type="button"
                  onClick={() => onShow(past.id)}
                  aria-current={past.id === run.id ? "true" : undefined}
                  className={`-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-[var(--radius-edge)] px-2 py-1.5 text-left text-[12px] transition-colors duration-150 ${
                    past.id === run.id
                      ? "bg-sunken/70 text-ink"
                      : "text-ink-muted hover:bg-sunken/40"
                  }`}
                >
                  <span className="tabular min-w-[84px] shrink-0 whitespace-nowrap text-ink-subtle">
                    {past.at.toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                  <span className="tabular w-9 shrink-0 font-mono">
                    {past.result === null ? "..." : (past.result.answer?.status ?? "-")}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-ink-subtle">
                    {summarise(past.input)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Status({ status }: { status: number }) {
  const good = status >= 200 && status < 300;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[var(--radius-edge)] border px-1.5 py-[2px] font-mono text-[11.5px] font-medium ${
        good
          ? "border-live/35 bg-live/10 text-live"
          : "border-failed/35 bg-failed/10 text-failed"
      }`}
    >
      {status}
      {REASONS[status] !== undefined ? (
        <span className="font-sans font-normal">{REASONS[status]}</span>
      ) : null}
    </span>
  );
}

function RiskMark({ risk }: { risk: CapabilityRisk }) {
  const style =
    risk === "read"
      ? "border-line bg-sunken text-ink-subtle"
      : "border-pending/40 bg-pending/10 text-pending";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-[var(--radius-edge)] border px-1.5 py-[3px] text-[10px] font-semibold tracking-[0.06em] uppercase ${style}`}
    >
      {risk}
    </span>
  );
}

/**
 * JSON with its keys set apart from its values, and nothing else.
 *
 * Tokenised from text that `JSON.stringify` has just produced, so the only
 * shapes to recognise are the ones it emits. Every piece is rendered as a
 * string child, never as markup.
 */
function Highlighted({ json }: { json: string }) {
  const parts: React.ReactNode[] = [];
  const token =
    /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let last = 0;
  let key = 0;
  for (const match of json.matchAll(token)) {
    const at = match.index;
    if (at > last) parts.push(json.slice(last, at));
    if (match[1] !== undefined && match[2] !== undefined) {
      parts.push(
        <span key={key++} className="text-ink-muted">
          {match[1]}
        </span>,
        match[2],
      );
    } else if (match[1] !== undefined) {
      parts.push(
        <span key={key++} className="text-live">
          {match[1]}
        </span>,
      );
    } else {
      parts.push(
        <span key={key++} className="text-pending">
          {match[0]}
        </span>,
      );
    }
    last = at + match[0].length;
  }
  if (last < json.length) parts.push(json.slice(last));
  return <>{parts}</>;
}

/** Runs are numbered per page load; they live no longer than that. */
let lastRunId = 0;

function startingValues(form: CapabilityForm): Values {
  if (form.kind === "json") return {};
  return Object.fromEntries(form.fields.map((f) => [f.name, f.initial]));
}

function prettyJson(text: string): string | null {
  if (text.trim() === "") return null;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

function duration(ms: number): string {
  if (ms < 1) return "under 1 ms";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

function summarise(input: Record<string, unknown>): string {
  const entries = Object.entries(input);
  if (entries.length === 0) return "No input";
  return entries
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("  ");
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function lower(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

const REASONS: Record<number, string> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  410: "Gone",
  422: "Unprocessable Content",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};
