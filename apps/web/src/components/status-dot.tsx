const STATES: Record<
  string,
  { dot: string; label: string; motion?: "ping" | "pulse-dot" }
> = {
  live: { dot: "bg-live text-live", label: "Live", motion: "pulse-dot" },
  deploying: { dot: "bg-pending text-pending", label: "Deploying", motion: "ping" },
  building: { dot: "bg-pending text-pending", label: "Building", motion: "ping" },
  queued: { dot: "bg-pending text-pending", label: "Queued", motion: "ping" },
  failed: { dot: "bg-failed text-failed", label: "Failed", motion: "pulse-dot" },
  removed: { dot: "bg-ink-subtle text-ink-subtle", label: "Removed" },
  draft: { dot: "bg-ink-subtle text-ink-subtle", label: "Draft" },
  "never-deployed": { dot: "bg-ink-subtle text-ink-subtle", label: "Not deployed" },
  unreachable: { dot: "bg-pending text-pending", label: "Running" },
};

/**
 * State in form as well as words: colour and motion carry it at a glance, and
 * the label is there for certainty and for anyone who cannot use the colour.
 *
 * A deploy in flight sends out a ring rather than blinking. A ring reads as
 * work going out; a blink reads as a fault light, which is the opposite of
 * what is happening. A live app and a failed one both keep a closer pulse
 * instead: neither is working, both are reporting a situation that will not
 * change by itself, and the colour is what says which.
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
  const state = STATES[status] ?? { dot: "bg-ink-subtle text-ink-subtle", label: status };

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 text-[10px] font-semibold tracking-[0.06em] text-ink-subtle uppercase ${
        compact ? "rounded-[var(--radius-edge)] border border-line px-1.5 py-[3px]" : ""
      }`}
    >
      <span
        aria-hidden="true"
        className={`relative h-[5px] w-[5px] rounded-full ${state.dot} ${state.motion ?? ""}`}
      />
      {label ?? state.label}
    </span>
  );
}
