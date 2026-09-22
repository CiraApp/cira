/**
 * The date these pages last changed, and the notice that they have not yet
 * been through a lawyer.
 *
 * Said out loud rather than left for someone to discover: a company reading
 * these is deciding whether to trust Cira, and quietly presenting an
 * unreviewed draft as a finished agreement would be the wrong first thing to
 * learn about us.
 */
export const UPDATED = "22 September 2026";

export function LegalDraftNotice() {
  return (
    <p className="mt-4 rounded-[var(--radius-edge)] border border-pending/40 bg-pending/5 px-4 py-3 text-[12.5px] leading-relaxed text-pending">
      A draft. These pages describe how Cira actually works today, but they have not been
      reviewed by a lawyer yet. If you are considering Cira for a company that needs a
      signed agreement, write to{" "}
      <a href="mailto:hello@cira.dev" className="underline underline-offset-4">
        hello@cira.dev
      </a>{" "}
      and we will work from your paper.
    </p>
  );
}
