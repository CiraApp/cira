import { UserButton } from "@clerk/nextjs";
import Link from "next/link";

export function TopBar({ spaceSlug }: { spaceSlug: string }) {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-canvas/85 backdrop-blur-sm">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-6">
        <Link
          href={`/${spaceSlug}`}
          className="text-[15px] font-semibold tracking-tight text-ink"
        >
          cira
        </Link>

        <UserButton appearance={{ elements: { avatarBox: "h-7 w-7" } }} />
      </div>
    </header>
  );
}
