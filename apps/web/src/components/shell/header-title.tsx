"use client";

import { usePathname } from "next/navigation";

/**
 * The header's title, re-entering on every route change.
 *
 * Keyed on the path so React discards the old node rather than mutating it,
 * which is what lets the entrance animation run again. It is a small move -
 * the header should acknowledge that the page changed, not perform it.
 */
export function HeaderTitle({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div key={pathname} className="enter-right min-w-0 flex-1">
      {children}
    </div>
  );
}
