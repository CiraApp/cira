import { CopyableCommand } from "./copyable-command";

/**
 * An empty space is the normal first state, not an error. It reads as an
 * invitation to deploy, and is the one screen where the command line earns
 * its place.
 */
export function EmptyGallery() {
  return (
    <div className="animate-rise flex flex-col items-center rounded-[var(--radius-card)] border border-dashed border-border-strong px-6 py-16 text-center">
      <Shelf className="mb-6 h-10 w-16 text-ink-subtle" />

      <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">
        Nothing on the shelf yet
      </h2>

      <p className="mx-auto mt-2 max-w-[38ch] text-[14px] leading-relaxed text-ink-muted">
        Apps appear here the moment someone deploys one. From a project folder, run:
      </p>

      <div className="mt-6">
        <CopyableCommand command="cira deploy" />
      </div>
    </div>
  );
}

/** An empty shelf: the product's own metaphor, drawn rather than described. */
function Shelf({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 40"
      fill="none"
      aria-hidden="true"
      className={className}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <rect x="1" y="1" width="18" height="18" rx="5" strokeDasharray="3 3" />
      <rect x="23" y="1" width="18" height="18" rx="5" strokeDasharray="3 3" />
      <rect x="45" y="1" width="18" height="18" rx="5" strokeDasharray="3 3" />
      <path d="M0 27h64" strokeWidth="2" />
      <path d="M6 27v6M58 27v6" opacity="0.5" />
    </svg>
  );
}
