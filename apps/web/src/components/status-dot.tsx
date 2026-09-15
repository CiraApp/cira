const STATES: Record<string, { dot: string; label: string; pulse: boolean }> = {
  live: { dot: "bg-live", label: "Live", pulse: false },
  deploying: { dot: "bg-pending", label: "Deploying", pulse: true },
  building: { dot: "bg-pending", label: "Building", pulse: true },
  queued: { dot: "bg-pending", label: "Queued", pulse: true },
  failed: { dot: "bg-failed", label: "Failed", pulse: false },
  removed: { dot: "bg-ink-subtle", label: "Removed", pulse: false },
  draft: { dot: "bg-ink-subtle", label: "Draft", pulse: false },
  "never-deployed": { dot: "bg-ink-subtle", label: "Never deployed", pulse: false },
  unreachable: { dot: "bg-pending", label: "Not reachable", pulse: false },
};

/**
 * State encoded in form as well as words: colour and motion carry it at a
 * glance, and the label is there for anyone who needs certainty or cannot see
 * the colour.
 */
export function StatusDot({ status, label }: { status: string; label?: string }) {
  const state = STATES[status] ?? {
    dot: "bg-ink-subtle",
    label: status,
    pulse: false,
  };

  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-ink-muted">
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${state.dot} ${state.pulse ? "animate-breathe" : ""}`}
      />
      {label ?? state.label}
    </span>
  );
}
