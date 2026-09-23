import { Onboarding } from "@/components/onboarding";
import { requireCurrentUser } from "@/lib/identity";
import { claimableDomain } from "@/lib/email-domain";
import { joinableSpaces } from "@/lib/join-actions";
import { listMySpaces } from "@/lib/authz";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Get started" };

export default async function OnboardingPage() {
  // Onboarding is for a signed-in person with nowhere to go yet. Reading the
  // user is what enforces that; there is no route list to keep in sync.
  const user = await requireCurrentUser();
  const domain = claimableDomain(user.email);
  const joinable = await joinableSpaces();
  // Someone already in a space came here to start another, and needs a way
  // back if they change their mind.
  const [home] = await listMySpaces();

  return (
    <Onboarding
      firstName={user.firstName ?? null}
      lastName={user.lastName ?? null}
      domain={domain}
      joinable={joinable.map((s) => ({ id: s.id, name: s.name, slug: s.slug }))}
      home={home === undefined ? null : { name: home.name, slug: home.slug }}
    />
  );
}
