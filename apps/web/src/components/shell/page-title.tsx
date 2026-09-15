/**
 * The header's left side: what you are looking at, and one line of context.
 *
 * Kept to two lines of small type rather than a display heading, because the
 * content below is the subject and the header is a label for it.
 */
export function PageTitle({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex min-w-0 flex-col justify-center">
      <h1 className="truncate text-[13px] font-semibold tracking-[-0.01em] text-ink">
        {title}
      </h1>
      {detail !== undefined ? (
        <p className="truncate text-[11px] text-ink-subtle">{detail}</p>
      ) : null}
    </div>
  );
}
