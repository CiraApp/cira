"use server";

import { revalidatePath } from "next/cache";
import { updateCapabilityEnabled } from "@/lib/capabilities";
import { requireCurrentUser } from "@/lib/identity";

export type ToggleResult = { ok: true } | { ok: false; error: string };

/**
 * Turn one capability on or off from the app's page.
 *
 * The acting user is resolved from the session here, never taken from the
 * form: the browser sends a capability id, not a right to change it.
 */
export async function setCapabilityEnabled(
  capabilityId: string,
  enabled: boolean,
): Promise<ToggleResult> {
  const user = await requireCurrentUser();
  const result = await updateCapabilityEnabled(user, capabilityId, enabled);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
