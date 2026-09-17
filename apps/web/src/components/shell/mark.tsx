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
 * The same object as the mark, spelled out. Every letter is built from
 * horizontals and a single 45 degree diagonal, one stroke weight throughout,
 * and where a curve would go there is a chevron instead - which is the whole
 * idea, because the mark beside it is a chevron too.
 *
 * That is what the first attempt got wrong. Drawn as ordinary angular capitals
 * they were merely a squared-off typeface: the R had a rectangular bowl and
 * the A a vertical stem with a crossbar, and next to the mark they looked like
 * lettering that happened to be nearby. Here the R's bowl closes to a point
 * and the A has no crossbar at all - it is a chevron standing on its legs with
 * a triangular counter cut out of the apex.
 *
 * Drawn rather than set for the reasons it always was: it cannot go wrong
 * while a font is still loading, and it holds its exact weight at 13px, where
 * a typeface would be hinted into something slightly else.
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
      {/* C - mitred where it is closed, and cut on the diagonal where it opens,
          so the arms taper toward the gap rather than ending as though cropped. */}
      <path d="M28,0 L96,0 L68,28 L44,28 L28,44 L28,56 L44,72 L68,72 L96,100 L28,100 L0,72 L0,28 Z" />
      {/* I */}
      <path d="M112,0 L140,0 L140,100 L112,100 Z" />
      {/* R - the bowl closes to a point instead of a curve, and its counter is
          the same shape inset, so the two are plainly one form. */}
      <path d="M156,0 L218,0 L256,38 L218,76 L252,100 L214,100 L190,76 L184,76 L184,100 L156,100 Z M184,28 L206.4,28 L216.4,38 L206.4,48 L184,48 Z" />
      {/* A - a chevron on its legs. No crossbar: the counter is cut out of the
          apex and runs open to the baseline. */}
      <path d="M310,0 L330,0 L368,100 L338,100 L320,52.6 L302,100 L272,100 Z" />
    </svg>
  );
}
