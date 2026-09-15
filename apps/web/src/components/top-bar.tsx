import { UserButton } from "@clerk/nextjs";
import Link from "next/link";

export function TopBar({ spaceSlug }: { spaceSlug: string }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-canvas/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-6">
        <Link
          href={`/${spaceSlug}`}
          aria-label="Cira home"
          // Negative margin keeps the mark where it looks right while giving the
          // link a thumb-sized area to actually hit.
          className="-m-2 flex items-center gap-2 rounded-lg p-2 transition-opacity hover:opacity-70"
        >
          <Mark className="h-[22px] w-[22px]" />
          <span className="text-[15px] font-semibold tracking-tight text-ink">cira</span>
        </Link>

        <UserButton appearance={{ elements: { avatarBox: "h-7 w-7" } }} />
      </div>
    </header>
  );
}

function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="8" fill="var(--color-accent)" />
      <path
        d="M21.5 11.4a7 7 0 1 0 0 9.2"
        fill="none"
        stroke="#fff"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
