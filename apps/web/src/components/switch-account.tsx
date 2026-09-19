"use client";

import { useState } from "react";
import { useClerk } from "@clerk/nextjs";

/**
 * A way out of the commonest dead end on an invite: the link opens in a
 * browser already signed in as somebody else - usually the same person's
 * other address - and the page can only say so.
 *
 * Signing out returns to the same invite, where the ordinary sign-in is
 * waiting, so the person carries on rather than working out for themselves
 * where to go.
 */
function label(email: string): string {
  return email.length <= 28 ? `Sign in as ${email}` : "Sign in with that address";
}

export function SwitchAccount({ backTo, email }: { backTo: string; email: string }) {
  const { signOut } = useClerk();
  const [leaving, setLeaving] = useState(false);

  return (
    <button
      type="button"
      disabled={leaving}
      onClick={() => {
        setLeaving(true);
        void signOut({ redirectUrl: backTo });
      }}
      className="btn btn-primary btn-lg"
    >
      {/* The address is named in full just above, so a long one is left out
          here rather than broken across lines inside the button. */}
      {leaving ? "Signing out..." : label(email)}
    </button>
  );
}
