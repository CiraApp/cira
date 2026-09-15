import { CopyableCommand } from "./copyable-command";

/**
 * An empty space is the normal first state, not an error. It reads as an
 * invitation to deploy, and is the one screen where the CLI is worth showing.
 */
export function EmptyGallery() {
  return (
    <div className="animate-rise flex flex-col items-center rounded-[var(--radius-card)] border border-dashed border-border-strong bg-surface/50 px-6 py-16 text-center">
      <div
        aria-hidden="true"
        className="mb-5 flex h-12 w-12 items-center justify-center rounded-[13px] bg-accent-soft"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-6 w-6 text-accent"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 16V5m0 0L8 9m4-4 4 4" />
          <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
        </svg>
      </div>

      <h2 className="text-[17px] font-medium text-ink">No apps yet</h2>

      <p className="mx-auto mt-2 max-w-sm text-[14px] leading-relaxed text-ink-muted">
        Apps appear here the moment someone deploys one. From a project folder, run:
      </p>

      <div className="mt-5">
        <CopyableCommand command="cira deploy" />
      </div>
    </div>
  );
}
