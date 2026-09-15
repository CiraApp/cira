const STATES: Record<string, { dot: string; label: string; pulse: boolean }> = {
  live: { dot: "bg-live text-live", label: "Live", pulse: false },
  deploying: { dot: "bg-pending text-pending", label: "Deploying", pulse: true },
  building: { dot: "bg-pending text-pending", label: "Building", pulse: true },
  queued: { dot: "bg-pending text-pending", label: "Queued", pulse: true },
  failed: { dot: "bg-failed text-failed", label: "Failed", pulse: false },
  removed: { dot: "bg-ink-subtle text-ink-subtle", label: "Removed", pulse: false },
  draft: { dot: "bg-ink-subtle text-ink-subtle", label: "Draft", pulse: false },
  "never-deployed": {
    dot: "bg-ink-subtle text-ink-subtle",
    label: "Not deployed",
    pulse: false,
  },
  unreachable: { dot: "bg-pending text-pending", label: "Unreachable", pulse: false },
};

/**
 * State in form as well as words: colour and motion carry it at a glance, and
 * the label is there for certainty and for anyone who cannot use the colour.
 *
 * A deploy in flight sends out a ring rather than blinking. A ring reads as
 * work going out; a blink reads as a fault light, which is the opposite of
 * what is happening.
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
  const state = STATES[status] ?? {
    dot: "bg-ink-subtle text-ink-subtle",
    label: status,
    pulse: false,
  };

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 text-[10px] font-semibold tracking-[0.06em] text-ink-subtle uppercase ${
        compact ? "rounded-[var(--radius-edge)] border border-line px-1.5 py-[3px]" : ""
      }`}
    >
      <span
        aria-hidden="true"
        className={`relative h-[5px] w-[5px] rounded-full ${state.dot} ${
          state.pulse ? "ping" : ""
        }`}
      />
      {label ?? state.label}
    </span>
  );
}
