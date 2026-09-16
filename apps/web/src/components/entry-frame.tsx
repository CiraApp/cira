import { AmbientField } from "@/components/ambient-field";
import { CiraMark } from "@/components/shell/mark";

/**
 * The frame for every screen that exists before a space does: onboarding, an
 * invite, connecting the CLI.
 *
 * One narrow column, centred, on the same lit ground as the product. These are
 * the first thing anyone sees of Cira, so they get the atmosphere rather than
 * a bare form on a flat page - and they get it from one place, so the three of
 * them cannot drift apart.
 *
 * Everything enters in sequence, top to bottom, at roughly the speed you read
 * it. Nothing moves after that.
 */
export function EntryFrame({
  mark = "logo",
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: {
  /** A finished step gets a tick; everything else carries the logo. */
  mark?: "logo" | "done";
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <>
      <AmbientField />

      <main className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-center px-6 py-16">
        <Mark kind={mark} />

        {eyebrow !== undefined ? (
          <p className="eyebrow enter-up mt-7" style={{ animationDelay: "70ms" }}>
            {eyebrow}
          </p>
        ) : null}

        <h1
          className="enter-up mt-2 text-[26px] leading-tight font-semibold tracking-[-0.02em] text-ink"
          style={{ animationDelay: "110ms" }}
        >
          {title}
        </h1>

        {subtitle !== undefined ? (
          <p
            className="enter-up mt-2.5 text-[14px] leading-relaxed text-ink-muted"
            style={{ animationDelay: "150ms" }}
          >
            {subtitle}
          </p>
        ) : null}

        {children !== undefined ? (
          <div className="enter-up mt-8" style={{ animationDelay: "200ms" }}>
            {children}
          </div>
        ) : null}

        {footer !== undefined ? (
          <div className="enter-up mt-6" style={{ animationDelay: "250ms" }}>
            {footer}
          </div>
        ) : null}
      </main>
    </>
  );
}

/**
 * The logo, lit from behind.
 *
 * The bloom is the app's own accent at low opacity and heavily blurred, which
 * is what stops a 44px tile on a near-black page reading as a sticker.
 */
function Mark({ kind }: { kind: "logo" | "done" }) {
  return (
    <div className="enter-pop relative h-11 w-11 shrink-0">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -inset-6 rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--color-accent)_45%,transparent),transparent_70%)] blur-lg"
      />

      <div
        aria-hidden="true"
        className="relative flex h-11 w-11 items-center justify-center rounded-[var(--radius-edge)] bg-accent"
      >
        {kind === "logo" ? (
          <CiraMark className="h-[21px] w-auto text-accent-ink" />
        ) : (
          <svg viewBox="0 0 32 32" className="h-[24px] w-[24px]">
            {/* Drawn rather than shown: the one moment in Cira where something
                is genuinely finished deserves to be seen finishing. */}
            <path
              className="draw"
              d="M9 16.8l4.8 4.8L23 12"
              fill="none"
              stroke="var(--color-accent-ink)"
              strokeWidth="3.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
    </div>
  );
}
