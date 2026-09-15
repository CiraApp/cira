import type { Route } from "next";
import Link from "next/link";

export function Wordmark({ href }: { href: Route }) {
  return (
    <Link
      href={href}
      aria-label="Cira home"
      className="-m-2 flex items-center gap-2 rounded-[var(--radius-edge)] p-2 transition-opacity duration-150 hover:opacity-70"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[19px] w-[19px]">
        <rect width="24" height="24" rx="3" fill="var(--color-accent)" />
        <path
          d="M16.4 8.6a5.3 5.3 0 1 0 0 6.8"
          fill="none"
          stroke="var(--color-accent-ink)"
          strokeWidth="2.7"
          strokeLinecap="round"
        />
      </svg>
      <span className="text-[14px] font-semibold tracking-[-0.02em] text-ink">Cira</span>
    </Link>
  );
}
