import { CliApprove } from "@/components/cli-approve";
import { EntryFrame } from "@/components/entry-frame";
import { requireCurrentUser } from "@/lib/identity";

export default async function CliPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const [{ code }, user] = await Promise.all([searchParams, requireCurrentUser()]);

  return (
    <EntryFrame title="Connect the Cira CLI" subtitle={`Signed in as ${user.email}.`}>
      <CliApprove initialCode={code ?? ""} />
    </EntryFrame>
  );
}
