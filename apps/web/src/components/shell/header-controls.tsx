"use client";

import { UserButton } from "@clerk/nextjs";

/**
 * What the header still owns: who you are signed in as.
 *
 * The colour swatch used to sit here beside it. It went to the foot of the
 * spine, next to the brand, because it changes how the product looks rather
 * than what this page is doing - and the header is for the latter.
 */
export function HeaderControls() {
  return <UserButton appearance={{ elements: { avatarBox: "h-[26px] w-[26px]" } }} />;
}
