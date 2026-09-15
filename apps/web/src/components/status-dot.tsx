const STATES: Record<string, { dot: string; label: string; pulse: boolean }> = {
  live: { dot: "bg-live", label: "Live", pulse: false },
  deploying: { dot: "bg-pending", label: "Deploying", pulse: true },
  building: { dot: "bg-pending", label: "Building", pulse: true },
  queued: { dot: "bg-pending", label: "Queued", pulse: true },
  failed: { dot: "bg-failed", label: "Failed", pulse: false },
  removed: { dot: "bg-ink-subtle", label: "Removed", pulse: false },
  draft: { dot: "bg-ink-subtle", label: "Draft", pulse: false },
  "never-deployed": { dot: "bg-ink-subtle", label: "Not deployed", pulse: false },
  unreachable: { dot: "bg-pending", label: "Unreachable", pulse: false },
};

/**
 * State in form as well as words: colour and motion carry it at a glance, and
 * the label is there for certainty and for anyone who cannot use the colour.
 */
export function StatusDot({
  status,
  label,
  compact = false,
}: {
  status: string;
  label?: string;
  compact?: boolean;
}) {
  const state = STATES[status] ?? { dot: "bg-ink-subtle", label: status, pulse: false };

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 text-[10px] font-semibold tracking-[0.06em] text-ink-subtle uppercase ${
        compact ? "rounded-[var(--radius-edge)] border border-line px-1.5 py-[3px]" : ""
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-[5px] w-[5px] rounded-full ${state.dot} ${state.pulse ? "breathe" : ""}`}
      />
      {label ?? state.label}
    </span>
  );
}
