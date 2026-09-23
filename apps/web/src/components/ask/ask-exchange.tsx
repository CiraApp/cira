"use client";

import { useState } from "react";
import { AppIcon } from "@/components/app-icon";
import { CiraMark } from "@/components/shell/mark";
import { humanize } from "@/lib/ask/words";
import type { ConfirmView, Exchange, StepView } from "./ask-provider";
import { Markdown } from "./markdown";

/**
 * One question and everything Cira did about it.
 *
 * Three layers, in the order a person wants them: the answer itself; the app
 * it came from, with the raw data a tap away; and a single collapsed line
 * saying what Cira did, which opens into every step. Nobody has to read the
 * steps, but anybody can, and being able to is what makes the answer
 * something to act on rather than something to double-check.
 */
export function AskExchange({
  exchange,
  latest,
  busy,
  onDecide,
  onRetry,
}: {
  exchange: Exchange;
  latest: boolean;
  busy: boolean;
  onDecide: (run: boolean) => void;
  onRetry: () => void;
}) {
  const streaming = exchange.status === "streaming";
  const source = [...exchange.steps]
    .reverse()
    .find((s) => s.state === "done" && s.data !== undefined);
  const thinking = streaming && exchange.text === "" && exchange.steps.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-[84%] self-end rounded-[6px_6px_2px_6px] border border-line bg-surface px-3.5 py-2 text-[14px] leading-relaxed text-ink">
        {exchange.question}
      </div>

      <div className="grid grid-cols-[24px_minmax(0,1fr)] gap-3">
        <span className="mt-px flex h-6 w-6 items-center justify-center rounded-[6px] bg-raised text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)]">
          <CiraMark className="h-2 w-auto" />
        </span>

        <div className="flex min-w-0 flex-col gap-3">
          {thinking ? <Thinking /> : null}

          {exchange.steps.length > 0 ? (
            <Steps steps={exchange.steps} streaming={streaming} />
          ) : null}

          {exchange.text !== "" ? (
            <div
              className={`ask-answer ${streaming && exchange.confirm === null ? "is-streaming" : ""}`}
            >
              <Markdown text={exchange.text} />
            </div>
          ) : null}

          {exchange.confirm !== null ? (
            <Confirm
              confirm={exchange.confirm}
              running={streaming}
              busy={busy}
              onDecide={onDecide}
            />
          ) : null}

          {source !== undefined && !streaming ? <Source step={source} /> : null}

          {exchange.error !== null ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
              <span className="text-failed">{exchange.error}</span>
              {latest && exchange.status === "stopped" ? (
                <button
                  type="button"
                  onClick={() => {
                    if (!busy) onRetry();
                  }}
                  aria-disabled={busy || undefined}
                  className="text-ink-muted underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink aria-disabled:opacity-50"
                >
                  Ask again
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Thinking() {
  return (
    <div className="flex items-center gap-2 py-1 text-[12.5px] text-ink-subtle">
      <span className="relative h-1.5 w-1.5 rounded-full bg-ink-subtle pulse-dot text-ink-subtle" />
      Thinking
    </div>
  );
}

/**
 * What Cira did, as one line that opens into every step.
 *
 * The line is written from the steps rather than by the model, so it is
 * always true: what is happening now while it runs, and afterwards which app
 * the answer came from - or that it could not get in.
 */
function Steps({ steps, streaming }: { steps: StepView[]; streaming: boolean }) {
  const running = steps.find((s) => s.state === "running");
  const refused = steps.find((s) => s.state === "refused");
  const lastApp = [...steps].reverse().find((s) => s.app !== undefined)?.app;

  const summary =
    running !== undefined && streaming ? (
      <>
        <StateMark state="running" />
        <span className="truncate">{running.label}…</span>
      </>
    ) : refused?.app !== undefined ? (
      <>
        <StateMark state="refused" />
        <span className="truncate">
          Couldn&rsquo;t get into{" "}
          <span className="font-medium text-ink">{refused.app.name}</span>
        </span>
      </>
    ) : lastApp !== undefined ? (
      <>
        <StateMark state={steps.some((s) => s.state === "failed") ? "failed" : "done"} />
        <span className="truncate">
          Checked <span className="font-medium text-ink">{lastApp.name}</span>
        </span>
      </>
    ) : (
      <>
        <StateMark state="done" />
        <span className="truncate">Looked through your apps</span>
      </>
    );

  return (
    <details className="group/steps overflow-hidden rounded-[5px] border border-line bg-[color-mix(in_oklab,var(--color-base)_50%,var(--color-panel))]">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2 text-[12.5px] text-ink-muted select-none [&::-webkit-details-marker]:hidden">
        {summary}
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className="ml-auto h-3.5 w-3.5 shrink-0 text-ink-subtle transition-transform duration-200 group-open/steps:rotate-180"
        >
          <path
            d="M4 6l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </summary>
      <ol className="flex flex-col border-t border-line px-3 pt-1 pb-3">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className="relative grid grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-2.5 pt-2 text-[12.5px] text-ink-muted"
          >
            {index < steps.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute top-[26px] -bottom-1.5 left-[7.5px] w-px bg-line"
              />
            ) : null}
            <StateMark state={step.state} />
            <span className="min-w-0">
              {step.app !== undefined ? (
                <span className="mr-1.5 inline-flex translate-y-[3px]">
                  <AppIcon appId={step.app.id} name={step.app.name} size="xs" />
                </span>
              ) : null}
              {step.label}
            </span>
            {step.detail !== undefined ? (
              <span className="pt-px font-mono text-[11px] text-ink-subtle">
                {step.detail}
              </span>
            ) : (
              <span />
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

function StateMark({ state }: { state: StepView["state"] }) {
  if (state === "running") {
    return (
      <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]">
        <span className="relative h-1.5 w-1.5 rounded-full bg-ink-muted pulse-dot text-ink-muted" />
      </span>
    );
  }

  const tone =
    state === "done"
      ? "bg-[color-mix(in_oklab,var(--color-live)_18%,transparent)] text-live"
      : state === "refused"
        ? "bg-[color-mix(in_oklab,var(--color-pending)_20%,transparent)] text-pending"
        : "bg-[color-mix(in_oklab,var(--color-failed)_18%,transparent)] text-failed";

  return (
    <span
      className={`mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${tone}`}
    >
      <svg viewBox="0 0 12 12" aria-hidden="true" className="h-2.5 w-2.5">
        {state === "done" ? (
          <path
            d="M2.5 6.2l2.2 2.2 4.8-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : state === "refused" ? (
          <>
            <rect
              x="2.5"
              y="5.3"
              width="7"
              height="5"
              rx="1"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <path
              d="M4 5.3V4a2 2 0 0 1 4 0v1.3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
            />
          </>
        ) : (
          <path
            d="M3.5 3.5l5 5m0-5l-5 5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        )}
      </svg>
    </span>
  );
}

/** Where the answer came from, and exactly what the app said. */
function Source({ step }: { step: StepView }) {
  const [open, setOpen] = useState(false);
  if (step.app === undefined) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[12px] text-ink-subtle">
        <AppIcon appId={step.app.id} name={step.app.name} size="xs" />
        <span className="min-w-0 truncate">{step.app.name}</span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="ml-auto shrink-0 text-ink-muted underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink"
        >
          {open ? "Hide the data" : "See the data"}
        </button>
      </div>
      {open ? (
        <pre className="enter-fade max-h-72 overflow-auto rounded-[5px] border border-line bg-sunken p-3 font-mono text-[11.5px] leading-relaxed text-ink-muted">
          {pretty(step.data ?? "")}
        </pre>
      ) : null}
    </div>
  );
}

function pretty(data: string): string {
  try {
    return JSON.stringify(JSON.parse(data), null, 2);
  } catch {
    return data;
  }
}

/**
 * A change, waiting for a person.
 *
 * Shows exactly what will be sent, as a plain table rather than JSON, and asks
 * once. The server has already stopped before calling anything; nothing here
 * can make it run except the button that says so.
 */
function Confirm({
  confirm,
  running,
  busy,
  onDecide,
}: {
  confirm: ConfirmView;
  running: boolean;
  busy: boolean;
  onDecide: (run: boolean) => void;
}) {
  const rows = Object.entries(confirm.input);

  return (
    <div className="enter-fade overflow-hidden rounded-[6px] border border-[color-mix(in_oklab,var(--color-pending)_45%,var(--color-line))] bg-[color-mix(in_oklab,var(--color-pending)_6%,var(--color-panel))]">
      <div className="flex flex-col gap-1.5 px-3.5 pt-3 pb-2.5">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.1em] text-pending uppercase">
          <span className="h-1.5 w-1.5 rounded-full bg-pending" />
          {confirm.state === "waiting"
            ? "Needs your OK"
            : confirm.state === "declined"
              ? "Not run"
              : running
                ? "Running"
                : "Ran"}
        </span>
        <span className="flex items-center gap-2.5 text-[14.5px] font-semibold tracking-[-0.01em] text-ink">
          <AppIcon appId={confirm.app.id} name={confirm.app.name} size="sm" />
          {confirm.action} in {confirm.app.name}
        </span>
      </div>

      {rows.length > 0 ? (
        <dl className="grid grid-cols-[minmax(90px,auto)_minmax(0,1fr)] border-t border-line text-[13px]">
          {rows.map(([name, value]) => (
            <div key={name} className="contents">
              <dt className="border-b border-line px-3.5 py-2 text-ink-subtle">
                {humanize(name)}
              </dt>
              <dd className="border-b border-line px-3.5 py-2 break-words text-ink">
                {shown(value)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {confirm.state === "waiting" ? (
        <>
          <p className="px-3.5 pt-2.5 text-[12px] text-ink-muted">
            This changes something in {confirm.app.name}, so it&rsquo;s yours to run.
          </p>
          <div className="flex gap-2 px-3.5 pt-3 pb-3.5">
            <button
              type="button"
              onClick={() => {
                if (!busy) onDecide(true);
              }}
              aria-disabled={busy || undefined}
              className="btn btn-primary"
            >
              Run it
            </button>
            <button
              type="button"
              onClick={() => {
                if (!busy) onDecide(false);
              }}
              aria-disabled={busy || undefined}
              className="btn btn-secondary"
            >
              Don&rsquo;t
            </button>
          </div>
        </>
      ) : (
        <div className="h-1" />
      )}
    </div>
  );
}

function shown(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
