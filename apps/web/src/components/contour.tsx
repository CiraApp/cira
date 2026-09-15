/**
 * Cloud contour linework.
 *
 * The outline a cloud leaves on a map, not a cloud: nested open curves that
 * read as a level set. Used where a screen would otherwise be blank, and never
 * behind anything that has to be read.
 */
export function Contour({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 320 120"
      fill="none"
      aria-hidden="true"
      className={className}
      stroke="currentColor"
      strokeWidth="0.9"
      strokeLinecap="round"
    >
      <path
        d="M14 96c18-1 24-12 44-14 21-2 25 8 45 5 19-3 20-20 43-23 24-3 30 12 51 10 20-2 26-14 47-12 18 2 28 11 48 9"
        opacity="0.55"
      />
      <path
        d="M30 74c16-2 22-11 40-13 19-2 24 7 41 4 18-3 19-17 39-20 22-3 27 10 46 9 18-1 24-12 43-11"
        opacity="0.4"
      />
      <path
        d="M52 53c14-2 19-9 34-11 16-2 21 6 35 4 15-2 17-14 34-16 18-3 23 9 39 8"
        opacity="0.28"
      />
      <path d="M78 34c11-2 15-7 27-9 13-1 17 5 28 3 12-1 14-11 27-13" opacity="0.18" />
    </svg>
  );
}
