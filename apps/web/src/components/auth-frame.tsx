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
 * Clerk's card keeps its own form - it is where the security lives - with the
 * chrome that would fight the frame taken off.
 */
export function AuthFrame({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <EntryFrame
      title={title}
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

/**
 * Clerk's card, fitted into the frame instead of floating on its own. Its
 * own heading goes: the frame already says what this is, and two headings
 * one above the other read as two different screens.
 */
export const AUTH_APPEARANCE = {
  elements: {
    rootBox: "w-full",
    cardBox: "w-full shadow-none",
    card: "w-full shadow-none",
    header: "hidden",
  },
} as const;
