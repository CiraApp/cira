import { redirect } from "next/navigation";
import { listMySpaces } from "@/lib/authz";

/**
 * Cira has no landing page for a signed-in person: they either have a space to
 * open or they need to make one. Nothing in between is worth a screen.
 */
export default async function Home() {
  const mySpaces = await listMySpaces();

  const first = mySpaces[0];
  if (first === undefined) redirect("/onboarding");

  redirect(`/${first.slug}`);
}
