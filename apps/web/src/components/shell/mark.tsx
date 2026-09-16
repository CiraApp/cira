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
 * The wordmark is lettering, not type: the same flat terminals and single
 * diagonal as the mark, with the shoulder of the r cut on that diagonal so the
 * two halves of the lockup share a vocabulary. Because it is a drawing it
 * cannot go wrong when Geist is still loading, and it keeps its exact weight
 * at 13px where a font would be hinted into something else.
 *
 * Its box runs from the top of the dot to the baseline, so a lockup aligns it
 * against the mark by centring the two boxes.
 */
export function CiraWordmark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 547.25 182"
      aria-hidden="true"
      className={className}
      fill="currentColor"
    >
      <path d="M167.25 85.75C165 87.25 134.57 92.5 130.75 92.5C129.65 92.5 128.11 89.99 127.34 89.24C123.4 85.4 119.07 82.13 114 79.93C98.97 73.42 80.34 73.05 64.75 77.73C31.77 87.62 23.74 130.55 57.75 145.29C74.41 152.51 97.55 152.45 114 144.59C119.14 142.13 125.62 134.63 129.75 133.25C137.13 133.25 160.96 135.24 167.25 137.75C168.31 138.81 159.4 151.57 157.77 153.5C145.76 167.72 128.36 176.33 110.25 179.75C63.9 188.5 3.41 172.98 0.29 116.75C-3.09 55.97 63.02 34.3 112.5 44.74C132.69 49.01 151.56 59.5 162.81 77.25C164.16 79.39 167.25 83.14 167.25 85.75ZM227.25 0.25C228.13 1.57 228.06 31.83 227.25 34.25C224.57 35.14 189.39 35.18 188 34.25L188 0.25L227.25 0.25ZM227.25 50.5C228.7 52.68 227.5 72.77 227.5 76.75L227.38 148.75L227.12 177.5L188 177.5C186.11 174.67 187.75 151.37 187.75 146.5C187.75 132.63 185.61 57.67 188 50.5C188.89 49.91 226.44 49.96 227.25 50.5ZM373.25 45.25C373.25 45.86 346.14 74.24 343.5 76C337.84 76 311.96 73.69 308.5 76C305.93 76.86 293.61 90.71 291.75 93.5L291.75 155.25C291.75 158.91 292.97 175.55 291.5 177.75C286.7 177.75 254.56 178.71 252.75 177.5C252.75 162.19 250.15 94.24 253.49 84.75C255.82 78.13 264.59 72.69 269.75 68.3C300.15 42.4 295.01 45 333.75 45C338.63 45 371.41 44.03 373.25 45.25ZM404 45L458.5 45C488.86 45 528.24 41.42 543.06 75C550.79 92.51 547.25 115.56 547.25 134.25C547.25 142.7 549.48 171.29 547 177.5C545.92 178.58 503.71 177.75 498.5 177.75C473.21 177.75 413.37 180.89 392 176.07C375.52 172.36 360.77 159.88 359.21 142.25C354.16 85.03 431.01 97.13 466.25 96.43L501.99 96.4C502.86 96.35 504.66 96.52 505 95.5C509.67 88.5 495.67 74.85 483.25 74.12C447.84 72.04 411.73 74 376.25 74C374.4 74 384.09 64.79 385.11 63.75C388.84 59.95 399.73 46.42 404 45ZM504.75 149.5C504.75 145.04 506.26 127.32 504.42 124.33C500.4 122.33 484.24 124 479 124C457.71 124 436.28 123.29 415 124C407.58 124.25 399.29 128.41 399.02 136.75C398.66 147.43 410.03 149.75 418.25 149.75C430.83 149.75 498.18 151.69 504.75 149.5Z" />
    </svg>
  );
}
