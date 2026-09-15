import { CliApprove } from "@/components/cli-approve";
import { requireCurrentUser } from "@/lib/identity";

export default async function CliPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const [{ code }, user] = await Promise.all([searchParams, requireCurrentUser()]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6 py-16">
      <h1 className="text-[26px] leading-tight font-semibold tracking-tight text-ink">
        Connect the Cira CLI
      </h1>

      <p className="mt-2.5 text-[15px] leading-relaxed text-ink-muted">
        Signed in as {user.email}.
      </p>

      <div className="mt-7">
        <CliApprove initialCode={code ?? ""} />
      </div>
    </main>
  );
}
