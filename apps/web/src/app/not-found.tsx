import Link from "next/link";
import type { Metadata } from "next";
import { EntryFrame } from "@/components/entry-frame";

export const metadata: Metadata = { title: "Not found" };

/**
 * Where a link that leads nowhere ends up: a mistyped address, an app since
 * removed, or one nobody has shared with this person - which Cira does not
 * tell apart, so that an address says nothing about what exists behind it.
 *
 * Next's own page stood in for this, white and in the system font, with no
 * way back.
 */
export default function NotFound() {
  return (
    <EntryFrame
      title="Nothing here"
      subtitle="This address does not lead to anything you can open. It may be mistyped, the app may have been removed, or it has not been shared with you - whoever manages it can give you access."
    >
      <Link href="/" className="btn btn-primary">
        Go to your apps
      </Link>
    </EntryFrame>
  );
}
