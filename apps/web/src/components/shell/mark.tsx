/**
 * Cira's mark.
 *
 * Two chevrons nested inside one another, opening to the right: every edge is
 * either horizontal or on a single 45 degree diagonal, the corners are mitred,
 * and both terminals are bevelled on that same diagonal so the arms taper
 * rather than end as though cropped. The outer stroke is the heavier of the
 * two and the channel between them is held at a constant width all the way
 * round the apex, which is what makes the pair read as one machined object
 * instead of two shapes that happen to be near each other.
 *
 * It is two paths in `currentColor` and nothing else: no tile, no gradient, no
 * second colour. That is what lets the same drawing serve a 13px signature, a
 * 21px tile on the sign-in page and the favicon without being redrawn.
 *
 * The mark is wider than it is tall (roughly 1.44:1), so call sites set a
 * height and leave the width to the viewBox rather than assuming a square.
 */
export function CiraMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 34.6 24"
      aria-hidden="true"
      className={className}
      fill="currentColor"
    >
      <path d="M12 0H34.6L30.87 3.73H13.54L5.27 12L13.54 20.27H30.87L34.6 24H12L0 12Z" />
      <path d="M14.46 5.92H28.6L26.2 8.32H15.46L11.78 12L15.46 15.68H26.2L28.6 18.08H14.46L8.38 12Z" />
    </svg>
  );
}

/**
 * Cira's name, drawn rather than set.
 *
 * Capitals, in the same vocabulary as the mark beside it: one stroke weight
 * throughout, every corner either square or mitred on a 45 degree chamfer, and
 * terminals cut on that same diagonal so the arms of the C taper toward the
 * opening instead of ending as though cropped. The counters are slots rather
 * than curves, which is what keeps the letters reading as machined parts of
 * one object rather than as type that happens to be angular.
 *
 * Drawn rather than set for two reasons that have not changed: it cannot go
 * wrong while a font is still loading, and it holds its exact weight at 13px,
 * where a typeface would be hinted into something slightly else.
 *
 * The box is the cap height exactly - no ascenders, no descenders - so a
 * lockup aligns it against the mark by centring the two boxes.
 */
export function CiraWordmark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 368 100"
      aria-hidden="true"
      className={className}
      fill="currentColor"
      fillRule="evenodd"
    >
      {/* C - chamfered on the closed side, tapered on the open one. */}
      <path d="M22,0 L82,0 L60,22 L44,22 L22,44 L22,56 L44,78 L60,78 L82,100 L22,100 L0,78 L0,22 Z" />
      {/* I */}
      <path d="M104,0 L126,0 L126,100 L104,100 Z" />
      {/* R - the leg is cut wider than the stem across the horizontal so that
          it measures the same weight perpendicular to its own diagonal. */}
      <path d="M148,0 L204,0 L226,22 L226,62 L248,100 L223,100 L201,62 L170,62 L170,100 L148,100 Z M170,22 L204,22 L204,40 L170,40 Z" />
      {/* A */}
      <path d="M312,0 L346,0 L368,22 L368,100 L346,100 L346,76 L306.6,76 L297,100 L272,100 Z M328.2,22 L346,22 L346,58 L313.8,58 Z" />
    </svg>
  );
}
