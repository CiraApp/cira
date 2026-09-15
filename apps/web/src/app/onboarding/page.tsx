import { CreateSpaceForm } from "@/components/create-space-form";
import { requireCurrentUser } from "@/lib/identity";

export default async function OnboardingPage() {
  // Onboarding is for a signed-in person who has no space yet. Reading the
  // user is what enforces that; there is no route list to keep in sync.
  const user = await requireCurrentUser();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-16">
      <p className="text-sm font-medium tracking-wide text-ink-subtle">
        Welcome to Cira, {user.name.split(" ")[0]}
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
