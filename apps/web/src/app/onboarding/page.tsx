import { Onboarding } from "@/components/onboarding";
import { requireCurrentUser } from "@/lib/identity";
import { claimableDomain } from "@/lib/email-domain";
import { joinableSpaces } from "@/lib/join-actions";

export default async function OnboardingPage() {
  // Onboarding is for a signed-in person with nowhere to go yet. Reading the
  // user is what enforces that; there is no route list to keep in sync.
  const user = await requireCurrentUser();
  const domain = claimableDomain(user.email);
  const joinable = await joinableSpaces();

  return (
    <Onboarding
      firstName={firstName(user.name)}
      domain={domain}
      joinable={joinable.map((s) => ({ id: s.id, name: s.name, slug: s.slug }))}
    />
  );
}

/**
 * Accounts created from an email alone carry the address as their name, and
 * "Welcome to Cira, sam@acme.com" is worse than no greeting at all.
 */
function firstName(name: string): string | null {
  const first = name.trim().split(/\s+/)[0] ?? "";
  if (first === "" || first.includes("@")) return null;
  return first;
}
