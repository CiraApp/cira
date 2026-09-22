import Link from "next/link";
import { EntryFrame } from "@/components/entry-frame";

/**
 * Signing in and signing up, inside Cira rather than on a bare card.
 *
 * The first screen a company's first person sees. It used to be Clerk's card
 * alone on an empty page: no mark, nothing about what happens next, and no
 * way back. Now it has the same frame as every other screen before a space
 * exists, says what the person is starting, and leads back out.
 *
 * Clerk's card keeps its own form and its own heading - the heading is where
 * each step says what it wants ("Check your email", and to which address),
 * and hiding it once left a code field with no word of where the code went.
 * So the frame has no heading of its own, only the one thing the card cannot
 * say.
 */
export function AuthFrame({
  subtitle,
  children,
}: {
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <EntryFrame
      subtitle={subtitle}
      footer={
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-subtle">
          <Link href="/" className="underline-offset-4 hover:text-ink hover:underline">
            Back to Cira
          </Link>
          <Link
            href="/pricing"
            className="underline-offset-4 hover:text-ink hover:underline"
          >
            Pricing
          </Link>
          <Link
            href="/legal/privacy"
            className="underline-offset-4 hover:text-ink hover:underline"
          >
            Privacy
          </Link>
        </p>
      }
    >
      {children}
    </EntryFrame>
  );
}

/** Clerk's card, fitted into the frame instead of floating on its own. */
export const AUTH_APPEARANCE = {
  elements: {
    rootBox: "w-full",
    cardBox: "w-full shadow-none",
    card: "w-full shadow-none",
  },
} as const;
