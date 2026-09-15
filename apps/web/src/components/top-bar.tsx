import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { ThemeToggle } from "./theme-toggle";

export function TopBar({ spaceSlug }: { spaceSlug: string }) {
  return (
    <header className="sticky top-[env(safe-area-inset-top,0px)] z-30 border-b border-border bg-canvas/85 backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-5 sm:px-6">
        <Link
          href={`/${spaceSlug}`}
          aria-label="Cira home"
          className="-m-2 flex items-center gap-2 rounded-lg p-2 transition-opacity hover:opacity-70"
        >
          <Mark className="h-[22px] w-[22px]" />
          <span className="text-[15px] font-bold tracking-[-0.03em] text-ink">cira</span>
        </Link>

        <div className="flex items-center gap-1">
          <ThemeToggle />
          <UserButton appearance={{ elements: { avatarBox: "h-7 w-7" } }} />
        </div>
      </div>
    </header>
  );
}

function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="9" fill="var(--color-accent)" />
      <path
        d="M21.8 11.2a7.2 7.2 0 1 0 0 9.6"
        fill="none"
        stroke="#fff"
        strokeWidth="3.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
