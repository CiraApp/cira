import type { UnconfirmedBecause } from "@cira/core";

/**
 * What the capability panel says over capabilities the app could not confirm.
 *
 * Why, and what happens next, in one line. The why differs - an app that
 * answers every address alike, or a route only calling it would reveal - and
 * is said when every one shares it; the next step is always the same.
 */
export function unconfirmedNote(
  items: ReadonlyArray<{ unconfirmedBecause?: UnconfirmedBecause | null | undefined }>,
): string {
  const reasons = new Set(items.map((item) => item.unconfirmedBecause ?? "cannot-tell"));
  const why =
    reasons.size === 1 && reasons.has("answers-everything")
      ? "This app answers every address alike, so Cira could not tell by asking whether it serves these."
      : reasons.size === 1
        ? "Cira could not tell from outside whether the app serves these; only calling one would."
        : "Cira could not tell by asking whether the app serves these.";
  return `${why} They stay off until someone turns one on, and its first real call settles it.`;
}
