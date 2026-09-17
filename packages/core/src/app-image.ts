/**
 * A picture chosen for an app.
 *
 * Small enough to live in the app's own row, which is only true because the
 * browser redraws it before sending: whatever was picked is scaled to a square
 * and re-encoded, so what arrives is a few kilobytes of a known type rather
 * than the four megabyte photograph somebody dragged in.
 *
 * Checked here as well, because the browser is the wrong place to enforce
 * anything. What is stored ends up in a `src` attribute on everybody else's
 * screen, so it has to be a picture and nothing else - `data:text/html` in an
 * `img` is harmless, but the habit of trusting the shape of a string that came
 * from a form is not.
 */

/** Square, and large enough to stay crisp on a retina screen at 48px. */
export const IMAGE_EDGE = 128;

/**
 * Generous for a 128 square, mean enough to refuse anything that is not one.
 * A webp of this size is typically under 8 kB; the ceiling is here to bound
 * the row, not to describe what is expected.
 */
export const MAX_IMAGE_BYTES = 96 * 1024;

const ALLOWED = ["image/webp", "image/png", "image/jpeg"] as const;

/** The data URL to store, or null when it is not one Cira will render. */
export function normalizeAppImage(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;

  const match = /^data:([a-z/+-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(trimmed);
  if (match === null) return null;

  const [, type, body] = match;
  if (type === undefined || body === undefined) return null;
  if (!ALLOWED.includes(type as (typeof ALLOWED)[number])) return null;

  // The declared length, not the string's: base64 carries four characters for
  // every three bytes, and the row is bounded by what it decodes to.
  const bytes = Math.floor((body.length * 3) / 4);
  if (bytes === 0 || bytes > MAX_IMAGE_BYTES) return null;

  return trimmed;
}
