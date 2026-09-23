import { CopyableCommand } from "./copyable-command";

/**
 * An empty space is the normal first state, not an error. It reads as an
 * invitation, and is the one screen where the command line earns its place.
 */
export function EmptyGallery() {
  return (
    <div className="enter-up relative flex flex-col items-center overflow-hidden rounded-[var(--radius-edge)] border border-dashed border-line-strong bg-base/80 px-6 py-16 text-center">
      <Grid className="mb-6 h-12 w-20 text-ink-subtle" />

      <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
        Nothing on the shelf yet
      </h2>

      <p className="mx-auto mt-1.5 max-w-[42ch] text-[13px] leading-relaxed text-ink-muted">
        Apps appear here the moment someone deploys one. From a project folder, run:
      </p>

      <div className="mt-6">
        <CopyableCommand command="cira deploy" />
      </div>
    </div>
  );
}

/** An empty grid: the product's own shape, drawn rather than described. */
function Grid({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 80 48"
      fill="none"
      aria-hidden="true"
      className={className}
      stroke="currentColor"
      strokeWidth="1.2"
    >
      <rect x="1" y="1" width="22" height="22" strokeDasharray="3 3" />
      <rect x="29" y="1" width="22" height="22" strokeDasharray="3 3" />
      <rect x="57" y="1" width="22" height="22" strokeDasharray="3 3" />
      <rect x="1" y="29" width="22" height="18" strokeDasharray="3 3" opacity="0.45" />
      <rect x="29" y="29" width="22" height="18" strokeDasharray="3 3" opacity="0.45" />
      <rect x="57" y="29" width="22" height="18" strokeDasharray="3 3" opacity="0.45" />
    </svg>
  );
}
