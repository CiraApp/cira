"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { LogRange, RuntimeLogEntry, RuntimeLogMinimum } from "@cira/core";
import {
  fetchRuntimeLogs,
  type RuntimeLogsRequest,
  type RuntimeLogsResult,
} from "@/lib/runtime-log-actions";
import { useHydrated } from "@/components/local-time";

/**
 * An app's runtime logs: a terminal, not a dashboard.
 *
 * Newest at the bottom, time on the left, and a dot that only has colour when
 * something went wrong. Request lines are rewritten into one line - method,
 * path, status, time taken - because that is what someone looking for the
 * failure scans for.
 *
 * Everything shown is in this component's memory and nowhere else. Leaving the
 * page is the end of it.
 */

/** How often Live asks for more. Google allows about sixty reads a minute for
 * the whole project, shared by everyone looking at any app, so this is slow on
 * purpose, and it stops while the tab is hidden. */
const LIVE_EVERY_MS = 10_000;

/** After Google says it is busy, how long before asking again. */
const BUSY_BACKOFF_MS = 30_000;

const RANGES: Array<{ value: LogRange; label: string; words: string }> = [
  { value: "15m", label: "15m", words: "the last 15 minutes" },
  { value: "1h", label: "1h", words: "the last hour" },
  { value: "24h", label: "24h", words: "the last 24 hours" },
  { value: "7d", label: "7d", words: "the last 7 days" },
];

const LEVELS: Array<{ value: RuntimeLogMinimum; label: string }> = [
  { value: "all", label: "All levels" },
  { value: "warning", label: "Warnings and errors" },
  { value: "error", label: "Errors only" },
];

type Failure = Extract<RuntimeLogsResult, { ok: false }>;

/**
 * The failures that can pass on their own. Anything else - no permission, a
 * demo app, one never deployed - stays true however often it is asked, so the
 * page stops offering controls that could only ask again.
 */
const PASSING: ReadonlySet<Failure["reason"]> = new Set(["busy", "unavailable"]);

export function RuntimeLogs({
  spaceSlug,
  appSlug,
  initial,
  around,
  process,
  sources,
}: {
  spaceSlug: string;
  appSlug: string;
  /** The first page, fetched with the page itself so it arrives filled. */
  initial: RuntimeLogsResult;
  /** A console run to centre on: when it started, and what it ran. */
  around: { at: string; label: string | null } | null;
  /** Which process these are the lines of; null for the web service. */
  process: string | null;
  /** What else could be read, for the picker. Shown when there is a choice. */
  sources: Array<{ value: string | null; label: string }>;
}) {
  const router = useRouter();
  const [range, setRange] = useState<LogRange | null>(around === null ? "1h" : null);
  const [minimum, setMinimum] = useState<RuntimeLogMinimum>("all");
  const hydrated = useHydrated();
  const [search, setSearch] = useState("");
  const [live, setLive] = useState(false);

  const [entries, setEntries] = useState<RuntimeLogEntry[]>(() =>
    initial.ok ? [...initial.entries].reverse() : [],
  );
  const [olderToken, setOlderToken] = useState<string | null>(
    initial.ok ? initial.nextPageToken : null,
  );
  const [window_, setWindow] = useState(initial.ok ? initial.window : null);
  const [failure, setFailure] = useState<Failure | null>(initial.ok ? null : initial);
  const [loading, setLoading] = useState(false);
  const [earlier, setEarlier] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const box = useRef<HTMLDivElement>(null);
  /** Whether the reader is at the bottom, so new lines keep them there. */
  const pinned = useRef(true);
  /** Bumped on every fresh load, so an answer to an older question is dropped. */
  const generation = useRef(0);
  /** The search the lines on screen answer, which paging and Live continue. */
  const searched = useRef("");

  const call = useCallback(
    (request: RuntimeLogsRequest) =>
      fetchRuntimeLogs(spaceSlug, appSlug, {
        ...request,
        ...(process === null ? {} : { process }),
      }),
    [spaceSlug, appSlug, process],
  );

  /** A fresh page, for exactly the range, level and search it is given. */
  const load = useCallback(
    async (
      spec: { range: LogRange } | { around: string },
      filter: { minimum: RuntimeLogMinimum; search: string },
    ) => {
      const mine = ++generation.current;
      searched.current = filter.search.trim();
      setLoading(true);
      let result: RuntimeLogsResult;
      try {
        result = await call({ ...spec, ...asFilter(filter) });
      } catch {
        result = unreachable();
      }
      if (mine !== generation.current) return;
      setLoading(false);
      setCheckedAt(new Date());
      if (!result.ok) {
        setFailure(result);
        setEntries([]);
        setOlderToken(null);
        return;
      }
      setFailure(null);
      setEntries([...result.entries].reverse());
      setOlderToken(result.nextPageToken);
      setWindow(result.window);
      setOpen(new Set());
      pinned.current = true;
    },
    [call],
  );

  const spec = useCallback(
    (): { range: LogRange } | { around: string } =>
      range !== null ? { range } : { around: around?.at ?? new Date().toISOString() },
    [range, around],
  );

  const reload = () => {
    if (loading) return;
    void load(spec(), { minimum, search });
  };

  const chooseRange = (next: LogRange) => {
    setRange(next);
    void load({ range: next }, { minimum, search });
  };

  const chooseLevel = (next: RuntimeLogMinimum) => {
    setMinimum(next);
    void load(spec(), { minimum: next, search });
  };

  // Search waits for Enter or a pause in typing, since every keystroke would
  // otherwise be a read against a quota the whole project shares.
  useEffect(() => {
    if (search.trim() === searched.current) return;
    const timer = setTimeout(() => void load(spec(), { minimum, search }), 600);
    return () => clearTimeout(timer);
  }, [search, minimum, load, spec]);

  const loadEarlier = async () => {
    if (olderToken === null || window_ === null || earlier) return;
    setEarlier(true);
    const before = box.current?.scrollHeight ?? 0;
    let result: RuntimeLogsResult;
    try {
      result = await call({
        window: window_,
        pageToken: olderToken,
        ...asFilter({ minimum, search: searched.current }),
      });
    } catch {
      result = unreachable();
    }
    setEarlier(false);
    if (!result.ok) {
      setFailure(result);
      return;
    }
    const older = [...result.entries].reverse();
    setEntries((now) => merge(older, now));
    setOlderToken(result.nextPageToken);
    // Keep the line the reader was looking at where it was.
    requestAnimationFrame(() => {
      const el = box.current;
      if (el !== null) el.scrollTop += el.scrollHeight - before;
    });
  };

  // Live: ask for anything at or after the newest line, every ten seconds,
  // while the tab is visible. A busy answer waits longer before the next ask.
  const newest = entries.at(-1)?.timestamp ?? null;
  useEffect(() => {
    if (!live) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState !== "visible") {
        timer = setTimeout(() => void tick(), LIVE_EVERY_MS);
        return;
      }
      const after = newest ?? (window_ !== null ? new Date(window_.until) : new Date());
      let result: RuntimeLogsResult;
      try {
        result = await call({
          after: new Date(after).toISOString(),
          ...asFilter({ minimum, search: searched.current }),
        });
      } catch {
        result = unreachable();
      }
      if (stopped) return;
      setCheckedAt(new Date());
      if (result.ok) {
        setFailure(null);
        setEntries((now) => merge(now, result.entries));
      } else {
        setFailure(result);
        // Asking again every ten seconds cannot change a missing permission.
        if (!PASSING.has(result.reason)) {
          setLive(false);
          return;
        }
      }
      const wait =
        !result.ok && result.reason === "busy" ? BUSY_BACKOFF_MS : LIVE_EVERY_MS;
      timer = setTimeout(() => void tick(), wait);
    };

    timer = setTimeout(() => void tick(), LIVE_EVERY_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [live, newest, window_, call, minimum]);

  // New lines at the bottom keep a reader who was already there at the bottom,
  // and leave one who had scrolled up to read something alone.
  useLayoutEffect(() => {
    const el = box.current;
    if (el !== null && pinned.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const onScroll = () => {
    const el = box.current;
    if (el !== null)
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  const toggle = (id: string) =>
    setOpen((now) => {
      const next = new Set(now);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const aroundAt = around === null ? null : new Date(around.at);
  const markerIndex =
    range === null && aroundAt !== null
      ? entries.findIndex((e) => new Date(e.timestamp) >= aroundAt)
      : -1;
  const spansDays =
    window_ !== null &&
    new Date(window_.until).getTime() - new Date(window_.since).getTime() > 20 * 3600_000;
  const words =
    range !== null
      ? RANGES.find((r) => r.value === range)?.words
      : `the two minutes around ${aroundAt === null ? "the run" : hydrated ? clock(aroundAt) : TIME_PENDING}`;

  // Nothing here can be read, and nothing on the toolbar would change that:
  // a range, a level or Live would each only ask Google the same question and
  // be told the same no. So the page says why, and offers nothing else.
  if (failure !== null && !PASSING.has(failure.reason)) {
    return <FailureNotice failure={failure} />;
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        {sources.length > 1 ? (
          <>
            <label className="sr-only" htmlFor="log-source">
              Process
            </label>
            <select
              id="log-source"
              value={process ?? ""}
              onChange={(e) => {
                const next = new URLSearchParams();
                if (e.target.value !== "") next.set("process", e.target.value);
                const query = next.toString();
                router.push(query === "" ? "?" : `?${query}`);
              }}
              className="field h-[30px] w-auto py-0 pr-8 text-[12.5px]"
            >
              {sources.map((source) => (
                <option key={source.value ?? ""} value={source.value ?? ""}>
                  {source.label}
                </option>
              ))}
            </select>
          </>
        ) : null}
        {range === null && around !== null ? (
          <span className="inline-flex h-[30px] items-center gap-2 rounded-[var(--radius-edge)] border border-line bg-surface pr-1 pl-2.5 text-[12px] text-ink">
            Around {around.label ?? "the run"} at{" "}
            {hydrated ? clock(new Date(around.at)) : TIME_PENDING}
            <button
              type="button"
              onClick={() => chooseRange("1h")}
              className="btn btn-ghost px-1.5 py-0.5 text-[11.5px]"
            >
              Show the last hour
            </button>
          </span>
        ) : (
          <div
            role="group"
            aria-label="Time range"
            className="inline-flex rounded-[var(--radius-edge)] border border-line bg-surface p-0.5"
          >
            {RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                aria-pressed={range === r.value}
                onClick={() => chooseRange(r.value)}
                className={`rounded-[2px] px-2.5 py-1 text-[12px] transition-colors duration-150 ${
                  range === r.value
                    ? "bg-sunken text-ink"
                    : "text-ink-subtle hover:text-ink"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}

        <label className="sr-only" htmlFor="log-level">
          Level
        </label>
        <select
          id="log-level"
          value={minimum}
          onChange={(e) => chooseLevel(e.target.value as RuntimeLogMinimum)}
          className="field h-[30px] w-auto py-0 pr-8 text-[12.5px]"
        >
          {LEVELS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>

        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            reload();
          }}
          className="min-w-[180px] flex-1"
        >
          <label className="sr-only" htmlFor="log-search">
            Search messages and paths
          </label>
          <input
            id="log-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search messages and paths"
            spellCheck={false}
            autoComplete="off"
            maxLength={200}
            className="field h-[30px] py-0 text-[12.5px]"
          />
        </form>

        <button
          type="button"
          aria-pressed={live}
          onClick={() => {
            setLive((on) => !on);
            pinned.current = true;
          }}
          className={`btn h-[30px] border px-2.5 py-0 text-[12.5px] ${
            live
              ? "border-live/45 bg-surface text-ink"
              : "border-line bg-surface text-ink-muted hover:text-ink"
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-[6px] w-[6px] rounded-full ${
              live
                ? "bg-live shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-live)_22%,transparent)]"
                : "bg-ink-subtle"
            }`}
          />
          Live
        </button>

        <button
          type="button"
          onClick={reload}
          aria-disabled={loading || undefined}
          className="btn btn-secondary h-[30px] px-2.5 py-0 text-[12.5px]"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {failure?.reason === "unavailable" ? (
        <div className="mt-3.5">
          <FailureNotice failure={failure} />
        </div>
      ) : (
        <div className="mt-3.5 overflow-hidden rounded-[var(--radius-edge)] border border-line bg-sunken/60">
          {failure?.reason === "busy" ? (
            <p className="border-b border-line bg-pending/[0.06] px-3.5 py-2 text-[12px] text-ink-muted">
              {failure.error}
            </p>
          ) : null}

          {olderToken !== null ? (
            <button
              type="button"
              onClick={() => void loadEarlier()}
              aria-disabled={earlier || undefined}
              className="block w-full border-b border-line py-2 text-center text-[12px] text-ink-muted transition-colors duration-150 hover:bg-surface/60 hover:text-ink aria-disabled:cursor-progress aria-disabled:opacity-60"
            >
              {earlier ? "Loading earlier lines..." : "Load earlier lines"}
            </button>
          ) : null}

          {/* Said as a count, not line by line: the list itself was a live
              region, so in Live mode a screen reader read every new line
              aloud, without end. */}
          <p role="status" className="sr-only">
            {loading
              ? "Loading lines"
              : earlier
                ? "Loading earlier lines"
                : `${entries.length} ${entries.length === 1 ? "line" : "lines"}`}
          </p>
          <div
            ref={box}
            onScroll={onScroll}
            aria-busy={loading}
            className={`max-h-[min(68vh,720px)] min-h-[220px] overflow-auto py-1.5 transition-opacity duration-150 ${
              loading ? "opacity-60" : ""
            }`}
          >
            {entries.length === 0 ? (
              <p className="px-3.5 py-10 text-center text-[12.5px] text-ink-subtle">
                {emptyMessage(minimum, searched.current, words ?? "this range")}
              </p>
            ) : (
              <ol className="min-w-0">
                {entries.map((entry, index) => (
                  <li key={entry.id}>
                    {index === markerIndex && around !== null ? (
                      <Marker label={around.label} at={new Date(around.at)} />
                    ) : null}
                    <Line
                      entry={entry}
                      withDate={spansDays}
                      open={open.has(entry.id)}
                      onToggle={() => toggle(entry.id)}
                    />
                  </li>
                ))}
                {markerIndex === -1 && around !== null && range === null ? (
                  <li>
                    <Marker label={around.label} at={new Date(around.at)} />
                  </li>
                ) : null}
              </ol>
            )}
          </div>

          <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-line bg-surface/40 px-3.5 py-2 text-[11.5px] text-ink-subtle">
            <span>
              {entries.length === 0
                ? ""
                : `${entries.length === 1 ? "1 line" : `${entries.length} lines`} from ${words} · newest at the bottom`}
            </span>
            <span className="tabular">
              {live
                ? "Checking for new lines every 10 seconds"
                : checkedAt !== null
                  ? `Fetched at ${clock(checkedAt)}`
                  : ""}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Line({
  entry,
  withDate,
  open,
  onToggle,
}: {
  entry: RuntimeLogEntry;
  withDate: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const hydrated = useHydrated();
  const detailId = useId();
  const at = new Date(entry.timestamp);
  const request = entry.request;
  const tone =
    entry.level === "error"
      ? "bg-failed"
      : entry.level === "warning"
        ? "bg-pending"
        : "shadow-[inset_0_0_0_1px_var(--color-line-strong)]";

  return (
    <div className={open ? "bg-surface/70" : ""}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={open ? detailId : undefined}
        className={`grid w-full min-w-0 gap-x-2.5 px-3.5 py-[3px] text-left font-mono text-[12px] leading-[1.65] transition-colors duration-100 hover:bg-surface/60 ${
          withDate
            ? "grid-cols-[100px_6px_minmax(0,1fr)] sm:grid-cols-[132px_6px_minmax(0,1fr)]"
            : "grid-cols-[60px_6px_minmax(0,1fr)] sm:grid-cols-[92px_6px_minmax(0,1fr)]"
        } ${entry.level === "error" ? "text-ink" : "text-ink-muted"}`}
      >
        <time dateTime={at.toISOString()} className="tabular text-ink-subtle">
          {!hydrated ? TIME_PENDING : withDate ? `${day(at)} ${clock(at)}` : clock(at)}
          {/* Milliseconds only where there is room for them: on a phone the
              message needs the width more than the time needs the precision. */}
          <span className="hidden sm:inline">.{millis(at)}</span>
        </time>
        {/* The dot is the level for the eye; the words are it for everyone. */}
        <span
          aria-hidden="true"
          className={`mt-[7px] h-[6px] w-[6px] rounded-full ${tone}`}
        />
        {entry.level === "default" ? null : (
          <span className="sr-only">{entry.level}: </span>
        )}
        <span className="min-w-0 break-words whitespace-pre-wrap">
          {entry.container !== null ? (
            <span className="mr-2 rounded-[2px] border border-line px-1 py-px text-[10.5px] text-ink-subtle">
              {entry.container}
            </span>
          ) : null}
          {request !== null ? (
            <span className="text-ink">
              {request.method} {request.path}{" "}
              {request.status !== null ? (
                <span
                  className={`font-medium ${
                    request.status >= 500
                      ? "text-failed"
                      : request.status >= 400
                        ? "text-pending"
                        : "text-live"
                  }`}
                >
                  {request.status}
                </span>
              ) : null}
              {request.latencyMs !== null ? (
                <span className="text-ink-subtle"> {request.latencyMs} ms</span>
              ) : null}
            </span>
          ) : (
            entry.message
          )}
          {entry.truncated ? (
            <span className="text-ink-subtle"> ... cut short, open for all of it</span>
          ) : null}
        </span>
      </button>
      {open ? (
        <pre
          id={detailId}
          className="mx-3.5 mt-1 mb-2 max-h-[360px] overflow-auto rounded-[var(--radius-edge)] border border-line bg-base/60 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-ink-muted"
        >
          {entry.detail}
        </pre>
      ) : null}
    </div>
  );
}

function Marker({ label, at }: { label: string | null; at: Date }) {
  const hydrated = useHydrated();
  return (
    <div className="my-1 flex items-center gap-2.5 border-y border-accent/30 bg-accent/[0.07] px-3.5 py-1.5 text-[11.5px]">
      <span className="font-medium text-ink">Your run</span>
      <span className="text-ink-subtle">
        {label !== null ? `${label} · ` : ""}
        {hydrated ? clock(at) : TIME_PENDING}
      </span>
    </div>
  );
}

/** Why there is nothing to show, said once, in place of the list. */
function FailureNotice({ failure }: { failure: Failure }) {
  // Yellow while it waits on somebody in Google Cloud; grey otherwise.
  const waiting = failure.reason === "not-allowed" || failure.reason === "disabled";
  return (
    <div className="flex items-start gap-2.5 rounded-[var(--radius-edge)] border border-line bg-surface px-4 py-3.5 text-[13px] leading-relaxed text-ink-muted">
      <span
        aria-hidden="true"
        className={`mt-[8px] h-[6px] w-[6px] shrink-0 rounded-full ${
          waiting ? "bg-pending" : "bg-ink-subtle"
        }`}
      />
      <p role="status">{failure.error}</p>
    </div>
  );
}

/** What an empty list means, naming every filter that made it empty. */
function emptyMessage(minimum: RuntimeLogMinimum, search: string, words: string): string {
  const what =
    minimum === "error" ? "errors" : minimum === "warning" ? "warnings or errors" : null;
  if (search !== "") return `No ${what ?? "lines"} match "${search}" in ${words}.`;
  if (what !== null) return `No ${what} in ${words}.`;
  return `Nothing was logged in ${words}.`;
}

/** Lines from both, oldest first, each once. */
function merge(a: RuntimeLogEntry[], b: RuntimeLogEntry[]): RuntimeLogEntry[] {
  const seen = new Set<string>();
  const out: RuntimeLogEntry[] = [];
  for (const entry of [...a, ...b]) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out.sort(
    (x, y) => new Date(x.timestamp).getTime() - new Date(y.timestamp).getTime(),
  );
}

/** The filters as the server takes them: an empty search is no search. */
function asFilter(filter: { minimum: RuntimeLogMinimum; search: string }): {
  minimum: RuntimeLogMinimum;
  search?: string;
} {
  const search = filter.search.trim();
  return search === ""
    ? { minimum: filter.minimum }
    : { minimum: filter.minimum, search };
}

function unreachable(): Failure {
  return { ok: false, reason: "unavailable", error: "Could not reach Cira. Try again." };
}

/**
 * Times are shown in the reader's own zone, which the server does not know:
 * formatted there they came out in UTC and then changed in the browser,
 * which React reports as a mismatch and a person sees as every time jumping.
 * So until the page has hydrated a time is a placeholder of the same width.
 */
const TIME_PENDING = "--:--:--";

function clock(at: Date): string {
  return at.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function millis(at: Date): string {
  return String(at.getMilliseconds()).padStart(3, "0");
}

function day(at: Date): string {
  return at.toLocaleDateString([], { month: "short", day: "numeric" });
}
