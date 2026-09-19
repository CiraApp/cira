"use server";

import { NO_SUCH_CAPABILITY } from "@/lib/capabilities";
import { getCurrentUser } from "@/lib/identity";
import { invokeCapability, type AppAnswer } from "@/lib/invoke-capability";

/**
 * One run from the capability console, as the page shows it.
 *
 * `error` is Cira's sentence when something stopped the run or the app said
 * no; `answer` is the app's own reply, whenever it gave one. A run can carry
 * both - a 500 is a failure and the app's body is exactly what the person
 * wants to read - and neither is ever kept anywhere but the browser that asked.
 */
export interface ConsoleRun {
  ok: boolean;
  error: string | null;
  answer: AppAnswer | null;
}

/**
 * Run a capability for the person looking at the console.
 *
 * Nothing about the run is taken on the browser's word but the capability's
 * id and the input. Who is asking comes from the session; whether they may,
 * whether the capability is on and confirmed, whether the input fits, and
 * where the request goes are all decided by `invokeCapability` - the same call
 * an agent's `invoke_capability` makes, so the console cannot allow anything
 * an agent would be refused, or the other way round.
 *
 * Nothing is logged or stored: the input and the app's reply go back to the
 * page that asked and nowhere else.
 */
export async function runCapability(
  capabilityId: unknown,
  input: unknown,
): Promise<ConsoleRun> {
  const user = await getCurrentUser();
  if (user === null) {
    return { ok: false, error: "Sign in to run capabilities.", answer: null };
  }

  if (typeof capabilityId !== "string") {
    return { ok: false, error: NO_SUCH_CAPABILITY, answer: null };
  }

  const result = await invokeCapability({ user, capabilityId, input });

  return result.ok
    ? { ok: true, error: null, answer: result.answer }
    : { ok: false, error: result.error, answer: result.answer ?? null };
}
