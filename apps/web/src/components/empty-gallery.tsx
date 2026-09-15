import { Contour } from "./contour";
import { CopyableCommand } from "./copyable-command";

/**
 * An empty space is the normal first state, not an error. It is also the
 * largest patch of air in the product, which makes it the right place for the
 * cloud contours to show rather than a screen someone is trying to read.
 */
export function EmptyGallery() {
  return (
    <div className="enter-up relative flex flex-col items-center overflow-hidden rounded-[var(--radius-edge)] border border-dashed border-line-strong px-6 py-20 text-center">
      <Contour className="pointer-events-none absolute -top-2 left-1/2 h-32 w-[520px] -translate-x-1/2 text-[var(--gold-metal)] opacity-30" />

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-40 opacity-60"
        style={{
          background:
            "radial-gradient(60% 100% at 50% 0%, color-mix(in oklab, var(--gold-metal) 16%, transparent), transparent 70%)",
        }}
      />

      <h2 className="relative text-[15px] font-semibold tracking-[-0.01em] text-ink">
        Nothing on the shelf yet
      </h2>

      <p className="relative mx-auto mt-1.5 max-w-[42ch] text-[13px] leading-relaxed text-ink-muted">
        Apps appear here the moment someone deploys one. From a project folder, run:
      </p>

      <div className="relative mt-6">
        <CopyableCommand command="cira deploy" />
      </div>
    </div>
  );
}
