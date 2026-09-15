import type { Route } from "next";
import Link from "next/link";

export function Wordmark({ href }: { href: Route }) {
  return (
    <Link
      href={href}
      aria-label="Cira home"
      className="-m-2 flex items-center gap-2 rounded-[var(--radius-edge)] p-2 transition-opacity duration-150 hover:opacity-70"
    >
      {/* The mark is the one object that is literally made of the metal. */}
      <span
        aria-hidden="true"
        className="metal metal-edge flex h-[19px] w-[19px] items-center justify-center rounded-[3px] border"
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-[15px] w-[15px]">
          <path
            d="M16.4 8.6a5.3 5.3 0 1 0 0 6.8"
            stroke="var(--gold-ink)"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span className="text-[14px] font-semibold tracking-[-0.02em] text-ink">Cira</span>
    </Link>
  );
}
