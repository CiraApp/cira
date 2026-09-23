"use client";

import { spoken } from "@/lib/spoken";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppIcon } from "@/components/app-icon";
import { CiraMark } from "@/components/shell/mark";
import { Portal } from "@/components/ui/portal";
import { MAX_QUESTION_CHARS } from "@/lib/ask/protocol";
import { AskExchange } from "./ask-exchange";
import { useAsk } from "./ask-provider";

/**
 * The conversation, docked on the right.
 *
 * It sits over the page rather than dimming it, because the point of keeping
 * it open across pages is being able to use the page: open the app it just
 * told you about and keep asking. On a phone there is no room beside anything,
 * so it takes the screen.
 */
export function AskPanel() {
  const ask = useAsk();
  const thread = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("");
  const pinned = useRef(true);

  const open = ask?.open ?? false;
  const exchanges = ask?.exchanges ?? [];

  // Follow the answer as it grows, unless someone has scrolled up to read
  // something earlier - dragging them back down mid-sentence would be rude.
  useLayoutEffect(() => {
    const el = thread.current;
    if (el !== null && pinned.current) el.scrollTop = el.scrollHeight;
  }, [exchanges, open]);

  // Where focus was when the panel opened, to give it back on close. Read
  // while rendering the opening, before the field below takes focus.
  const returnTo = useRef<HTMLElement | null>(null);
  if (open && returnTo.current === null && typeof document !== "undefined") {
    returnTo.current = document.activeElement as HTMLElement | null;
  }
  useEffect(() => {
    if (open) return;
    returnTo.current?.focus();
    returnTo.current = null;
  }, [open]);

  // What a screen reader hears: that Cira is working, then the answer once it
  // is whole. The answer streams in word by word, and reading that out as it
  // arrives would be a sentence restarted a hundred times.
  const last = exchanges.at(-1);
  const said =
    last === undefined
      ? ""
      : last.status === "streaming"
        ? "Cira is working on it."
        : last.error !== null
          ? last.error
          : last.confirm !== null
            ? "Cira needs you to confirm before it goes on."
            : spoken(last.text);

  // Grown to its content, up to about six lines, the same bargain the app
  // description field makes.
  useLayoutEffect(() => {
    const el = field.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, [draft, open]);

  if (ask === null || !open) return null;

  const send = () => {
    const question = draft.trim();
    if (question === "" || ask.busy) return;
    pinned.current = true;
    ask.ask(question);
    setDraft("");
  };

  const empty = exchanges.length === 0;

  return (
    <Portal>
      <p role="status" className="sr-only">
        {said}
      </p>
      <section
        role="dialog"
        aria-label="Ask Cira"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            ask.hide();
          }
        }}
        className={`enter-right fixed inset-0 z-40 flex flex-col bg-panel sm:inset-y-0 sm:right-0 sm:left-auto sm:border-l sm:border-line-strong sm:shadow-[var(--ask-sheet-shadow)] ${
          ask.wide ? "sm:w-[min(860px,100vw)]" : "sm:w-[500px]"
        }`}
      >
        <header className="flex h-14 shrink-0 items-center gap-1 border-b border-line pr-2.5 pl-[18px] pt-[env(safe-area-inset-top,0px)]">
          <span className="flex items-center gap-2.5 text-[14px] font-semibold tracking-[-0.01em] text-ink">
            <CiraMark className="h-2.5 w-auto" />
            Ask Cira
          </span>
          <span className="flex-1" />
          <PanelButton
            label="New conversation"
            onClick={ask.reset}
            disabled={ask.busy || empty}
          >
            <path
              d="M8 3.5v9M3.5 8h9"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </PanelButton>
          <span className="hidden sm:contents">
            <PanelButton label={ask.wide ? "Narrower" : "Wider"} onClick={ask.toggleWide}>
              {ask.wide ? (
                <path
                  d="M12.5 3.5L9 7m0 0V4m0 3h3M3.5 12.5L7 9m0 0v3m0-3H4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : (
                <path
                  d="M9.5 3.5h3v3M6.5 12.5h-3v-3M12.5 3.5L9 7M3.5 12.5L7 9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </PanelButton>
          </span>
          <PanelButton label="Close" onClick={ask.hide}>
            <path
              d="M4.5 4.5l7 7m0-7l-7 7"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </PanelButton>
        </header>

        <div
          ref={thread}
          onScroll={(event) => {
            const el = event.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-6 pb-4"
        >
          {empty ? (
            <Welcome onPick={(question) => ask.ask(question)} />
          ) : (
            <div
              className={`mx-auto flex flex-col gap-7 ${ask.wide ? "max-w-[680px]" : ""}`}
            >
              {exchanges.map((exchange, index) => (
                <AskExchange
                  key={exchange.id}
                  exchange={exchange}
                  latest={index === exchanges.length - 1}
                  busy={ask.busy}
                  // Both take away the buttons that were pressed; the question
                  // field is where anyone goes next.
                  onDecide={(run) => {
                    ask.decide(run);
                    field.current?.focus();
                  }}
                  onRetry={() => {
                    ask.retry();
                    field.current?.focus();
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-line bg-panel px-4 pt-3 pb-[max(14px,env(safe-area-inset-bottom,0px))]">
          <div
            className={`flex items-end gap-2.5 rounded-[6px] bg-base py-2 pr-2 pl-3.5 shadow-[inset_0_0_0_1px_var(--color-line-strong)] transition-shadow duration-200 focus-within:shadow-[inset_0_0_0_1px_var(--color-accent),0_0_0_3px_color-mix(in_oklab,var(--color-accent)_14%,transparent)] ${
              ask.wide ? "mx-auto max-w-[680px]" : ""
            }`}
          >
            <textarea
              ref={field}
              // Focused as the panel appears. An effect ran before the field
              // existed - the panel is portalled a render later - and so
              // never focused anything.
              autoFocus
              rows={1}
              value={draft}
              maxLength={MAX_QUESTION_CHARS}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // Enter sends, Shift+Enter is a new line, and nothing is sent
                // while an input method is still composing a character.
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder={empty ? "Ask anything…" : "Ask a follow-up…"}
              aria-label="Ask Cira"
              className="max-h-[150px] min-w-0 flex-1 resize-none bg-transparent py-1.5 text-[14px] leading-[1.45] text-ink outline-none placeholder:text-ink-subtle"
            />
            <button
              type="button"
              onClick={send}
              disabled={ask.busy || draft.trim() === ""}
              aria-label="Send"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] bg-accent text-accent-ink transition-[background-color,opacity] duration-150 hover:bg-accent-hover disabled:bg-surface disabled:text-ink-subtle disabled:shadow-[inset_0_0_0_1px_var(--color-line)]"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
                <path
                  d="M8 13V3.5M3.8 7.5L8 3.3l4.2 4.2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
          <p
            className={`mt-2 flex items-center justify-between gap-3 text-[11.5px] text-ink-subtle ${
              ask.wide ? "mx-auto max-w-[680px]" : ""
            }`}
          >
            <span>
              Cira can only use apps you can open, and asks before changing anything.
            </span>
            <kbd className="hidden shrink-0 rounded-[2px] border border-line bg-sunken px-1.5 py-[3px] font-mono text-[10px] font-medium sm:inline">
              esc
            </kbd>
          </p>
        </div>
      </section>
    </Portal>
  );
}

/**
 * A new conversation never opens on an empty page.
 *
 * The suggestions are questions this person's own apps can answer, so the
 * first thing anyone taps works - and they are all reads, so none of them
 * stops to ask permission.
 */
function Welcome({ onPick }: { onPick: (question: string) => void }) {
  const ask = useAsk();
  const suggestions = ask?.suggestions ?? [];

  return (
    <div className="enter-up flex flex-col pt-2">
      <CiraMark className="h-4 w-auto self-start text-ink" />
      <h2 className="mt-3 text-[22px] font-semibold tracking-[-0.03em] text-ink">
        What do you need?
      </h2>
      <p className="mt-1 text-[13.5px] text-ink-muted">
        Ask in plain words. Cira finds the app that knows and asks it for you.
      </p>

      {suggestions.length > 0 ? (
        <div className="mt-5 flex flex-col gap-1.5">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.question}
              type="button"
              onClick={() => onPick(suggestion.question)}
              className="flex items-center gap-2.5 rounded-[5px] border border-line bg-surface px-3 py-2.5 text-left text-[13.5px] text-ink transition-colors duration-150 hover:border-line-strong hover:bg-raised"
            >
              <AppIcon appId={suggestion.app.id} name={suggestion.app.name} size="xs" />
              <span className="min-w-0 flex-1 truncate">{suggestion.question}</span>
              <span className="shrink-0 text-[11.5px] text-ink-subtle">
                {suggestion.app.name}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PanelButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-[30px] w-[30px] items-center justify-center rounded-[var(--radius-edge)] text-ink-subtle transition-colors duration-150 hover:bg-surface hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" className="h-[15px] w-[15px]">
        {children}
      </svg>
    </button>
  );
}
