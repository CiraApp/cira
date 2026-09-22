"use client";

import { useEffect, useId, useRef } from "react";
import { Portal } from "./portal";

/**
 * A panel over the page, for a decision that deserves one: removing someone,
 * editing a team. The same backdrop, motion and dismissal as the invite
 * dialog, so every dialog in Cira behaves alike: Escape or a click outside
 * closes it, and focus starts inside it.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  width = "max-w-md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  width?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // Focus the first thing that takes it, so a keyboard lands in the dialog.
    const first = panel.current?.querySelector<HTMLElement>(
      "input, select, textarea, button:not([data-dialog-close])",
    );
    first?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <Portal>
      <div
        className="enter-fade fixed inset-0 z-50 flex items-start justify-center bg-sunken/70 px-5 pt-[12vh] backdrop-blur-[3px]"
        onMouseDown={(e) => {
          if (!panel.current?.contains(e.target as Node)) onClose();
        }}
      >
        <div
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={`enter-pop w-full ${width} rounded-[var(--radius-edge)] border border-line-strong bg-raised p-6 shadow-[var(--shadow-panel)]`}
        >
          <h2
            id={titleId}
            className="text-[15px] font-semibold tracking-[-0.01em] text-ink"
          >
            {title}
          </h2>
          {description === undefined ? null : (
            <div className="mt-1.5 text-[12.5px] leading-relaxed text-ink-muted">
              {description}
            </div>
          )}
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </Portal>
  );
}
