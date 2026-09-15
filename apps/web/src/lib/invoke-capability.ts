import "server-only";

import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { apps, db } from "@cira/db";
import { isSafeTargetPath, type Capability, type User } from "@cira/core";
import {
  getCapabilityForUser,
  NO_SUCH_CAPABILITY,
  type CapabilityWithApp,
} from "@/lib/capabilities";
import { latestDeployment } from "@/lib/queries";
import { validateInput } from "@/lib/json-schema";

/**
 * Run one capability against the app that owns it.
 *
 * The only operation that turns a discovered capability into a real request,
 * so it is where every rule has to actually hold. In order: the user is
 * resolved from the session, the capability is fetched through the same
 * permission path the gallery uses, it must be enabled, the input must satisfy
 * its schema, and only then is a URL built - from the app's own deployment,
 * never from anything supplied by the caller.
 *
 * That last point is the one that matters most. A capability carries a method
 * and a root-relative path and nothing else; the host comes from the
 * deployment row. There is no code path here that can be handed a URL.
 */

export type InvocationResult =
  | { ok: true; status: number; data: unknown }
  | { ok: false; error: string; status?: number };

/** A deployed app gets a few seconds; an agent is waiting on the other end. */
const TIMEOUT_MS = 15_000;

/** Enough for a report, small enough that one call cannot exhaust the server. */
const MAX_RESPONSE_BYTES = 1_000_000;

export async function invokeCapability(args: {
  user: User;
  capabilityId: string;
  input: unknown;
}): Promise<InvocationResult> {
  // Resolves the acting user from the session and applies app access. A
  // capability the caller cannot see reads as one that does not exist.
  const capability = await getCapabilityForUser(args.user, args.capabilityId);
  if (capability === null) return { ok: false, error: NO_SUCH_CAPABILITY };

  if (!capability.enabled) {
    return {
      ok: false,
      error: `${capability.name} is registered but not enabled. An admin can turn it on from the app's page.`,
    };
  }

  const validation = validateInput(capability.inputSchema, args.input);
  if (!validation.ok) {
    return { ok: false, error: `Invalid input: ${validation.error}` };
  }

  const target = await resolveTarget(capability);
  if (target === null) {
    return { ok: false, error: `${capability.appName} is not reachable right now.` };
  }

  return call(target, capability, validation.value);
}

interface ResolvedTarget {
  url: URL;
  secret: string;
}

/**
 * Where this capability actually lives.
 *
 * Built from the app's current deployment and the capability's own path. The
 * path is re-checked here even though it was checked before it was stored:
 * this is the last point before a network call, and the cost of the check is
 * nothing next to what it prevents.
 */
async function resolveTarget(capability: Capability): Promise<ResolvedTarget | null> {
  if (!isSafeTargetPath(capability.target.path)) return null;

  const deployment = await latestDeployment(capability.appId);
  if (deployment === null || deployment.status !== "live" || deployment.url === null) {
    return null;
  }

  const [row] = await db()
    .select({ accessSecret: apps.accessSecret })
    .from(apps)
    .where(eq(apps.id, capability.appId))
    .limit(1);

  const secret = row?.accessSecret ?? null;
  if (secret === null || secret === "") return null;

  let url: URL;
  try {
    url = new URL(deployment.url);
  } catch {
    return null;
  }

  // Path assignment rather than `new URL(path, base)`: assigning cannot change
  // the origin, whatever the path turns out to contain.
  url.pathname = capability.target.path;
  url.search = "";
  url.hash = "";

  return { url, secret };
}

/**
 * Make the call.
 *
 * A GET carries its input as query parameters and a POST as a JSON body,
 * because that is what a normal Next.js route already expects - the whole
 * premise is that the app was not written for Cira.
 */
async function call(
  target: ResolvedTarget,
  capability: CapabilityWithApp,
  input: Record<string, unknown>,
): Promise<InvocationResult> {
  const url = new URL(target.url);
  let body: string | undefined;

  if (capability.target.method === "GET") {
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(
        key,
        typeof value === "object" ? JSON.stringify(value) : String(value),
      );
    }
  } else {
    body = JSON.stringify(input);
  }

  // The app is unreachable without the bypass, so holding it is already proof
  // this is Cira. The signature is what lets an app that wants to check say so
  // for itself, without Cira having to run a secrets system to make it possible.
  const signature = createHmac("sha256", target.secret)
    .update(`${capability.target.method}\n${url.pathname}\n${body ?? ""}`)
    .digest("hex");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: capability.target.method,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-vercel-protection-bypass": target.secret,
        "x-cira-capability": capability.name,
        "x-cira-signature": signature,
        ...(body === undefined ? {} : { "content-length": String(body.length) }),
      },
      ...(body === undefined ? {} : { body }),
      signal: controller.signal,
      redirect: "manual",
      cache: "no-store",
    });
  } catch (error) {
    clearTimeout(timer);
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      error: aborted
        ? `${capability.name} took longer than ${TIMEOUT_MS / 1000} seconds.`
        : `Could not reach ${capability.appName}.`,
    };
  } finally {
    clearTimeout(timer);
  }

  // A redirect from a capability is the app asking for a login it should never
  // need, or pointing somewhere else entirely. Neither is worth following.
  if (response.status >= 300 && response.status < 400) {
    return { ok: false, error: `${capability.name} did not return a result.` };
  }

  const text = await readCapped(response);
  if (text === null) {
    return { ok: false, error: `${capability.name} returned too much data.` };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: `${capability.name} failed (${response.status}).`,
    };
  }

  if (text.trim() === "") return { ok: true, status: response.status, data: null };

  try {
    return { ok: true, status: response.status, data: JSON.parse(text) };
  } catch {
    // A capability is a structured operation. An app answering with HTML is
    // answering a different question, and passing that on to an agent as if it
    // were a result is worse than saying it did not work.
    return { ok: false, error: `${capability.name} did not return JSON.` };
  }
}

/** Read the body, giving up rather than buffering something unbounded. */
async function readCapped(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_RESPONSE_BYTES) return null;

  const reader = response.body?.getReader();
  if (reader === undefined) return "";

  const chunks: Uint8Array[] = [];
  let size = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  return new TextDecoder().decode(concat(chunks, size));
}

function concat(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}
