"use client";

import { useState } from "react";
import { useClerk } from "@clerk/nextjs";

/** Sign out and land on the sign-in page, for a screen that is a dead end. */
export function SignOutButton({ label = "Sign out" }: { label?: string }) {
  const { signOut } = useClerk();
  const [leaving, setLeaving] = useState(false);

  return (
    <button
      type="button"
      disabled={leaving}
      onClick={() => {
        setLeaving(true);
        void signOut({ redirectUrl: "/sign-in" });
      }}
      className="btn btn-secondary btn-lg"
    >
      {leaving ? "Signing out..." : label}
    </button>
  );
}
