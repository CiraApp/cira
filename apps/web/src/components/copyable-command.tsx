"use client";

import { useEffect, useState } from "react";

/**
 * A command someone is meant to run elsewhere, so the useful action is copying
 * it rather than reading it. Confirmation is inline and brief; a toast for
 * something this small would be louder than the action.
 */
export function CopyableCommand({
  command,
  shell = true,
}: {
  command: string;
  /** A shell prompt marker suits a command, not a URL. */
  shell?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [canCopy, setCanCopy] = useState(false);

  // Clipboard access needs a secure context, so the button only appears where
  // it will actually work. Elsewhere the command is still readable and
  // selectable, which is the thing that matters.
  useEffect(() => {
    setCanCopy(typeof navigator !== "undefined" && navigator.clipboard !== undefined);
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      setCanCopy(false);
    }
  };

  const body = (
    <>
      {shell ? <span className="text-ink-subtle select-none">$</span> : null}
      <code className="min-w-0 truncate font-mono text-[13px] text-ink">{command}</code>
    </>
  );

  if (!canCopy) {
    return (
      <span className="flex max-w-full items-center gap-2 rounded-xl border border-border bg-canvas px-4 py-2.5">
        {body}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : `Copy "${command}"`}
      className={`group flex w-full max-w-full items-center gap-2 rounded-[var(--radius-edge)] border px-4 py-2.5 text-left transition-colors duration-150 ${copied ? "metal-edge shimmer bg-[var(--gold-quiet)]" : "border-line bg-sunken hover:border-line-strong"}`}
    >
      {body}
      <span className="ml-1 w-[52px] text-left text-[11px] font-medium text-ink-subtle transition-colors group-hover:text-ink-muted">
        {copied ? "Copied" : "Copy"}
      </span>
    </button>
  );
}
