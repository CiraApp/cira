/**
 * A name made possessive: "Dana's", but "Operations'" - not "Operations's",
 * which is what every sentence built as `${name}'s` said about a team, and
 * about any company or app whose name ends in an s.
 *
 * `mark` is the apostrophe the caller writes in: plain in emails and data,
 * the typographic one in the interface.
 */
export function possessive(name: string, mark: "'" | "’" = "'"): string {
  return /s$/i.test(name.trim()) ? `${name}${mark}` : `${name}${mark}s`;
}
