/**
 * An empty space is the normal first state, not an error. It should read as an
 * invitation to deploy, and it is the one place the CLI is worth showing.
 */
export function EmptyGallery() {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-border-strong bg-surface/60 px-6 py-14 text-center">
      <h2 className="text-[17px] font-medium text-ink">No apps yet</h2>

      <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-ink-muted">
        Apps show up here as soon as someone deploys one. From a project folder, run:
      </p>

      <code className="mt-5 inline-block rounded-lg bg-canvas px-4 py-2.5 font-mono text-sm text-ink ring-1 ring-border">
        cira deploy
      </code>
    </div>
  );
}
