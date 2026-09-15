"use client";

import { UserButton } from "@clerk/nextjs";
import { ThemeToggle } from "@/components/theme-toggle";

export function HeaderControls() {
  return (
    <div className="flex items-center gap-1.5">
      <ThemeToggle />
      <div className="h-4 w-px bg-line" aria-hidden="true" />
      <UserButton appearance={{ elements: { avatarBox: "h-[26px] w-[26px]" } }} />
    </div>
  );
}
