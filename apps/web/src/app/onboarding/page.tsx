import { CreateSpaceForm } from "@/components/create-space-form";
import { JoinSpace } from "@/components/join-space";
import { requireCurrentUser } from "@/lib/identity";
import { claimableDomain } from "@/lib/email-domain";
import { joinableSpaces } from "@/lib/join-actions";

export default async function OnboardingPage() {
  // Onboarding is for a signed-in person with nowhere to go yet. Reading the
  // user is what enforces that; there is no route list to keep in sync.
  const user = await requireCurrentUser();
  const domain = claimableDomain(user.email);
  const joinable = await joinableSpaces();

  const firstName = user.name.split(" ")[0];

  if (joinable.length > 0 && domain !== null) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-16">
        <p className="text-sm font-medium tracking-wide text-ink-subtle">
          Welcome to Cira, {firstName}
        </p>

        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink">
          {joinable.length === 1 ? "Your team is already here" : "Your teams are here"}
        </h1>

        <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
          We recognised {domain}, so you can join without an invite.
        </p>

        <div className="mt-8">
          <JoinSpace spaces={joinable} domain={domain} />
        </div>

        <details className="group mt-8">
          <summary className="cursor-pointer list-none text-[13px] text-ink-muted transition-colors hover:text-ink">
            Or create a separate space
          </summary>
          <div className="mt-4">
            <CreateSpaceForm />
          </div>
        </details>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-16">
      <p className="text-sm font-medium tracking-wide text-ink-subtle">
        Welcome to Cira, {firstName}
      </p>

      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink">
        Create your space
      </h1>

      <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
        A space is your company. Everything your team deploys lives inside it.
      </p>

      <div className="mt-8">
        <CreateSpaceForm />
      </div>
    </main>
  );
}
