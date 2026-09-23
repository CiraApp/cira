/**
 * The header's left side: what you are looking at, and one line of context.
 *
 * Kept to two lines of small type rather than a display heading, because the
 * content below is the subject and the header is a label for it.
 */
export function PageTitle({
  title,
  detail,
  pageHasHeading = false,
}: {
  title: string;
  detail?: string;
  /**
   * The page names itself in its own heading (an app's page, its logs), so
   * this label is not a second one: a page with two h1s gives a screen-reader
   * user two answers to "where am I".
   */
  pageHasHeading?: boolean;
}) {
  const Title = pageHasHeading ? "p" : "h1";
  return (
    <div className="flex min-w-0 flex-col justify-center">
      <Title className="truncate text-[13px] font-semibold tracking-[-0.01em] text-ink">
        {title}
      </Title>
      {detail !== undefined ? (
        <p className="truncate text-[11px] text-ink-subtle">{detail}</p>
      ) : null}
    </div>
  );
}
