"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { verifyPendingInSpace } from "@/lib/capability-retry";
import type { AskApp, AskEvent, AskMessage, StepState } from "@/lib/ask/protocol";

/**
 * Everything Ask Cira remembers, and the one place that talks to `/api/ask`.
 *
 * Mounted in the space's layout rather than in each page's shell, because
 * Next keeps a layout mounted across the pages beneath it: the panel stays
 * open, and an answer that is still arriving keeps arriving, while someone
 * moves from the gallery into the app it is telling them about.
 *
 * The conversation is kept in this tab's session storage and nowhere else.
 * It survives a refresh, it is gone when the tab closes, and it is filed under
 * the person's id so that someone else signing in on the same machine starts
 * with nothing. Every read and write of it is guarded: storage can be full,
 * disabled or absent, and none of that should cost anyone their answer.
 */

export interface StepView {
  id: string;
  state: StepState;
  label: string;
  detail?: string;
  app?: AskApp;
  data?: string;
}

export interface ConfirmView {
  toolUseId: string;
  app: AskApp;
  action: string;
  description: string;
  input: Record<string, unknown>;
  state: "waiting" | "sending" | "ran" | "declined";
}

export interface Exchange {
  id: string;
  question: string;
  steps: StepView[];
  text: string;
  confirm: ConfirmView | null;
  error: string | null;
  status: "streaming" | "done" | "stopped";
}

interface Stored {
  v: 1;
  history: AskMessage[];
  exchanges: Exchange[];
  open: boolean;
  wide: boolean;
}

interface AskContextValue {
  open: boolean;
  wide: boolean;
  busy: boolean;
  exchanges: Exchange[];
  suggestions: Suggestion[];
  show: () => void;
  hide: () => void;
  toggleWide: () => void;
  ask: (question: string) => void;
  decide: (run: boolean) => void;
  retry: () => void;
  reset: () => void;
}

/** A question worth offering, from a capability this person can really run. */
export interface Suggestion {
  question: string;
  app: AskApp;
}

const AskContext = createContext<AskContextValue | null>(null);

/** Null outside a space, where there is nothing to ask - callers hide instead. */
export function useAsk(): AskContextValue | null {
  return useContext(AskContext);
}

const PREFIX = "cira.ask.";

/**
 * An answer that ended without finishing. A step still marked as running
 * never will finish, and leaving it that way let the summary above it read
 * "Checked Ledger" with a tick, over an answer that never came.
 */
function stopped(exchange: Exchange, error: string | null): Exchange {
  return {
    ...exchange,
    status: "stopped",
    error: exchange.error ?? error,
    steps: exchange.steps.map((step) =>
      step.state === "running" ? { ...step, state: "failed" as const } : step,
    ),
  };
}

function load(key: string): Stored | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Stored;
    if (parsed.v !== 1 || !Array.isArray(parsed.history)) return null;
    // An answer that was still arriving when the page went away never will.
    return {
      ...parsed,
      exchanges: parsed.exchanges.map((exchange) =>
        exchange.status === "streaming"
          ? stopped(exchange, "This answer was interrupted.")
          : exchange,
      ),
    };
  } catch {
    return null;
  }
}

function save(key: string, value: Stored) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Full or unavailable. The conversation still works; it just won't
    // survive a refresh.
  }
}

/** Anything left behind by a different person on this machine goes. */
function forgetOthers(key: string) {
  try {
    for (let i = window.sessionStorage.length - 1; i >= 0; i -= 1) {
      const name = window.sessionStorage.key(i);
      if (name !== null && name.startsWith(PREFIX) && name !== key) {
        window.sessionStorage.removeItem(name);
      }
    }
  } catch {
    // Nothing to clear if storage cannot be read.
  }
}

export function AskProvider({
  userId,
  spaceSlug,
  suggestions,
  unsettled = false,
  children,
}: {
  userId: string;
  spaceSlug: string;
  suggestions: Suggestion[];
  /** Whether anything in this space is still waiting to be confirmed. */
  unsettled?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const settling = useRef(false);

  // Confirmed once per visit rather than left for someone to open each app,
  // because a question usually arrives before anyone has. The refresh is what
  // brings the new suggestions, and what Ask Cira can now reach, onto the page.
  useEffect(() => {
    if (!unsettled || settling.current) return;
    settling.current = true;
    void verifyPendingInSpace(spaceSlug).then((result) => {
      if (result.settled) router.refresh();
    });
  }, [unsettled, spaceSlug, router]);

  const key = `${PREFIX}${userId}`;

  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const history = useRef<AskMessage[]>([]);
  // State rather than a ref, so saving waits for the render that actually
  // holds what was restored. As a ref it flipped inside the same pass as the
  // restore, and the save beside it wrote the empty starting state over the
  // conversation it was meant to keep.
  const [restored, setRestored] = useState(false);

  // Restored after the first paint, never during render: the server has no
  // session storage, and reading it while rendering would make the markup
  // disagree with what the server sent.
  useEffect(() => {
    forgetOthers(key);
    const stored = load(key);
    if (stored !== null) {
      history.current = stored.history;
      setExchanges(stored.exchanges);
      setOpen(stored.open);
      setWide(stored.wide);
    }
    setRestored(true);
  }, [key]);

  useEffect(() => {
    if (!restored) return;
    save(key, { v: 1, history: history.current, exchanges, open, wide });
  }, [key, restored, exchanges, open, wide]);

  const update = useCallback((id: string, change: (exchange: Exchange) => Exchange) => {
    setExchanges((all) =>
      all.map((exchange) => (exchange.id === id ? change(exchange) : exchange)),
    );
  }, []);

  /** Send one request and fold its events into the exchange they belong to. */
  const stream = useCallback(
    async (exchangeId: string, body: Record<string, unknown>) => {
      setBusy(true);
      let finished = false;

      const apply = (event: AskEvent) => {
        switch (event.type) {
          case "text":
            update(exchangeId, (e) => ({ ...e, text: e.text + event.text }));
            break;
          case "step":
            update(exchangeId, (e) => {
              const step: StepView = {
                id: event.id,
                state: event.state,
                label: event.label,
                ...(event.detail === undefined ? {} : { detail: event.detail }),
                ...(event.app === undefined ? {} : { app: event.app }),
                ...(event.data === undefined ? {} : { data: event.data }),
              };
              const at = e.steps.findIndex((s) => s.id === event.id);
              const steps =
                at === -1
                  ? [...e.steps, step]
                  : e.steps.map((s, i) => (i === at ? step : s));
              return { ...e, steps };
            });
            break;
          case "confirm":
            update(exchangeId, (e) => ({
              ...e,
              confirm: {
                toolUseId: event.toolUseId,
                app: event.app,
                action: event.action,
                description: event.description,
                input: event.input,
                state: "waiting",
              },
            }));
            break;
          case "error":
            update(exchangeId, (e) => ({ ...e, error: event.message }));
            break;
          case "done":
            finished = true;
            history.current = event.messages;
            update(exchangeId, (e) => ({ ...e, status: "done" }));
            break;
        }
      };

      try {
        const response = await fetch("/api/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: history.current, space: spaceSlug, ...body }),
        });

        if (!response.ok || response.body === null) {
          const reason = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          update(exchangeId, (e) => ({
            ...e,
            error:
              reason?.error ?? "Cira couldn't answer just now. Try again in a moment.",
          }));
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Events are separated by a blank line; the last piece may be the
          // start of one that has not finished arriving.
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            const line = part.split("\n").find((l) => l.startsWith("data: "));
            if (line === undefined) continue;
            try {
              apply(JSON.parse(line.slice(6)) as AskEvent);
            } catch {
              // A malformed event is skipped rather than ending the answer.
            }
          }
        }
      } catch {
        update(exchangeId, (e) => ({
          ...e,
          error: e.error ?? "The connection dropped before Cira finished.",
        }));
      } finally {
        if (!finished) update(exchangeId, (e) => stopped(e, null));
        setBusy(false);
      }
    },
    [update],
  );

  const ask = useCallback(
    (question: string) => {
      const text = question.trim();
      if (text === "" || busy) return;

      setOpen(true);
      const id = crypto.randomUUID();
      // A write still waiting when someone moves on is closed off by the
      // server; the card says so here, so it is never left asking.
      setExchanges((all) => [
        ...all.map((e) =>
          e.confirm?.state === "waiting"
            ? { ...e, confirm: { ...e.confirm, state: "declined" as const } }
            : e,
        ),
        {
          id,
          question: text,
          steps: [],
          text: "",
          confirm: null,
          error: null,
          status: "streaming",
        },
      ]);
      void stream(id, { question: text });
    },
    [busy, stream],
  );

  const decide = useCallback(
    (run: boolean) => {
      const waiting = [...exchanges]
        .reverse()
        .find((e) => e.confirm?.state === "waiting");
      if (waiting === undefined || waiting.confirm === null || busy) return;

      const { toolUseId } = waiting.confirm;
      update(waiting.id, (e) => ({
        ...e,
        status: "streaming",
        error: null,
        confirm:
          e.confirm === null ? null : { ...e.confirm, state: run ? "ran" : "declined" },
      }));
      void stream(waiting.id, { decision: { toolUseId, run } });
    },
    [busy, exchanges, stream, update],
  );

  /** Ask the last question again, after an answer that did not arrive. */
  const retry = useCallback(() => {
    const last = exchanges.at(-1);
    if (last === undefined || busy) return;
    setExchanges((all) => all.slice(0, -1));
    ask(last.question);
  }, [ask, busy, exchanges]);

  const reset = useCallback(() => {
    if (busy) return;
    history.current = [];
    setExchanges([]);
  }, [busy]);

  const value: AskContextValue = {
    open,
    wide,
    busy,
    exchanges,
    suggestions,
    show: () => setOpen(true),
    hide: () => setOpen(false),
    toggleWide: () => setWide((w) => !w),
    ask,
    decide,
    retry,
    reset,
  };

  return <AskContext.Provider value={value}>{children}</AskContext.Provider>;
}
