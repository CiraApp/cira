/**
 * Cira's mark.
 *
 * A C cut from two planes. Every edge is either horizontal or on one angle,
 * the corners are mitred rather than rounded, the terminals are bevelled so
 * the arms taper instead of ending as though cropped, and the two halves are
 * separated by a hairline seam at the apex - so it reads as something machined
 * out of a solid, which is the register the rest of the interface is drawn in.
 *
 * It is one path pair in `currentColor` and nothing else: no tile, no gradient,
 * no second colour. That is what lets it sit at 16px in a sidebar footer, at
 * 26px inside an accent tile on the sign-in page, and at 32px in a browser tab
 * without being redrawn for each.
 */
export function CiraMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M19 4H9.5L3.67 11.4h4.4L11.06 7.6H17.3Z" />
      <path d="M19 20H9.5l-5.83-7.4h4.4l2.99 3.8H17.3Z" />
    </svg>
  );
}
