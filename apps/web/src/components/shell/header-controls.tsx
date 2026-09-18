"use client";

import { UserButton } from "@clerk/nextjs";

/**
 * What the header still owns: who you are signed in as.
 *
 * The colour swatch used to sit here beside it. It went to the foot of the
 * spine, next to the brand, because it changes how the product looks rather
 * than what this page is doing - and the header is for the latter.
 */
export function HeaderControls({ spaceSlug }: { spaceSlug: string }) {
  return (
    <UserButton appearance={{ elements: { avatarBox: "h-[26px] w-[26px]" } }}>
      {/* First in the menu, because it is the one entry that is about you in
          Cira rather than about your sign-in. */}
      <UserButton.MenuItems>
        <UserButton.Link
          label="Your profile"
          href={`/${spaceSlug}/~/profile`}
          labelIcon={<PersonGlyph />}
        />
      </UserButton.MenuItems>
    </UserButton>
  );
}

function PersonGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    >
      <circle cx="8" cy="5.6" r="2.6" />
      <path d="M3.2 13.6c0-2.6 2.1-4.3 4.8-4.3s4.8 1.7 4.8 4.3" />
    </svg>
  );
}
