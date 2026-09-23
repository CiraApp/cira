/**
 * Somewhere to say what just happened, for anyone who cannot see it happen:
 * "Saved", "Removed Dana's access", "Copied".
 *
 * Always in the page, empty until there is something to say. Screen readers
 * announce a status region when its text changes; one inserted into the page
 * already holding its text is, in NVDA and VoiceOver, often not announced at
 * all - which is how most of Cira's "Saved" messages used to go unheard.
 *
 * Visible text stays where it is, for the eye; this is the same words for the
 * ear, so the two never have to be the same element.
 */
export function LiveStatus({ message }: { message: string | null | undefined }) {
  return (
    // A span, so it can sit inside a button as well as beside one.
    <span role="status" className="sr-only">
      {message ?? ""}
    </span>
  );
}
