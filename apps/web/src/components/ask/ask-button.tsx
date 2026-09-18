"use client";

import { CiraMark } from "@/components/shell/mark";
import { useAsk } from "./ask-provider";

/**
 * The door to Ask Cira on every page.
 *
 * The one filled button in the header, because it is the one thing in the
 * header a person who does not write software should notice. On a phone it
 * keeps its mark and loses its words, since the header has room for little.
 */
export function AskButton() {
  const ask = useAsk();
  if (ask === null) return null;

  return (
    <button
      type="button"
      onClick={ask.open ? ask.hide : ask.show}
      aria-pressed={ask.open}
      aria-label="Ask Cira"
      className="flex h-[30px] shrink-0 items-center gap-2 rounded-[var(--radius-edge)] bg-accent px-2.5 text-[12.5px] font-medium tracking-[-0.005em] text-accent-ink transition-colors duration-150 hover:bg-accent-hover"
    >
      <CiraMark className="h-[9px] w-auto" />
      <span className="hidden sm:inline">Ask Cira</span>
    </button>
  );
}
