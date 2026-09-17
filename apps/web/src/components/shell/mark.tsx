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
 * Cira's name.
 *
 * The wordmark as drawn, dropped in exactly as it was given. Three attempts
 * went into reconstructing these letterforms from a picture of them and all
 * three were wrong in the same way - close enough to read as CIRA, not close
 * enough to be the logo. A brand mark is not a thing to approximate, and the
 * file existed.
 *
 * Left alone deliberately: no re-spacing, no re-weighting, no tidying of the
 * coordinates. The only thing added is `aria-hidden`, because every place this
 * is used sits inside a link that already names itself.
 *
 * Source: cira-wordmark.svg. Its box carries a little air above and below the
 * caps, so a lockup sizes it against the mark by eye rather than by assuming
 * the height is the cap height.
 */
export function CiraWordmark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 650 128"
      aria-hidden="true"
      className={className}
      preserveAspectRatio="xMidYMid meet"
      fill="currentColor"
    >
      <path d="M491 124 L584 125 L562 98 L513 98 Z" />
      <path d="M433 125 L471 125 L539 32 L608 125 L647 125 L559 3 L524 3 Z" />
      <path d="M249 3 L249 125 L279 125 L281 29 L378 29 L389 40 L364 64 L300 64 L363 124 L412 125 L371 89 L381 88 L426 44 L425 37 L392 3 Z" />
      <path d="M192 3 L192 125 L223 125 L223 3 Z" />
      <path d="M2 36 L2 91 L38 124 L167 125 L141 98 L53 98 L32 78 L32 49 L54 29 L143 29 L170 3 L39 3 Z" />
    </svg>
  );
}
