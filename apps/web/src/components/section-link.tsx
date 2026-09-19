import type { Route } from "next";
import Link from "next/link";

/**
 * The quiet link at the right of a section heading: somewhere to go that is
 * about the section, and not a button on it.
 */
export function SectionLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href as Route}
      className="group inline-flex items-center gap-1 text-[12px] text-ink-muted transition-colors duration-150 hover:text-ink"
    >
      {children}
      <svg
        viewBox="0 0 12 12"
        aria-hidden="true"
        className="h-2.5 w-2.5 self-center transition-transform duration-300 ease-[var(--ease-spring)] group-hover:translate-x-0.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2.5 6h7M6.5 3l3 3-3 3" />
      </svg>
    </Link>
  );
}
