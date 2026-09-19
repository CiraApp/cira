import "server-only";

import { deploymentProvider } from "@cira/deploy";
import { fillTargetPath, isSafeTargetPath, type Capability, type User } from "@cira/core";
import {
  getCapabilityForUser,
  recordRefusal,
  NO_SUCH_CAPABILITY,
  type CapabilityWithApp,
} from "@/lib/capabilities";
import { latestDeployment } from "@/lib/queries";
import { validateInput } from "@/lib/json-schema";
import { demoAnswer } from "@/lib/demo/answers";

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
  | { ok: true; status: number; data: unknown; answer: AppAnswer }
  | { ok: false; error: string; status?: number; answer?: AppAnswer };

/**
 * Exactly what the app said, whenever it said anything.
 *
 * Kept beside the verdict rather than folded into it. An agent is best served
 * by one sentence - "getRevenue failed (500)" - and that sentence is unchanged.
 * A person running the capability by hand is served by the app's own words: the
 * status, the body as it came back, and how long it took. Present on success
 * and on failure alike, and absent only when the app was never reached - a
 * check refused the call, or the network never got an answer.
 */
export interface AppAnswer {
  status: number;
  /** The body as text, as the app sent it, up to the response cap. */
  body: string;
  contentType: string | null;
  elapsedMs: number;
}

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

  // Asked before `enabled`, because `enabled` is false for both of these and
  // the sentence it offers - go and ask an admin - is only true for one of
  // them. Telling an agent to get a refused capability switched on sends it
  // after something nobody can do.
  if (capability.reach === "refused") return { ok: false, error: refusal(capability) };

  if (capability.reach === "pending") {
    return {
      ok: false,
      error: `Cira has not confirmed ${capability.name} with ${capability.appName} yet.`,
    };
  }

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

  // The demo company's apps have nothing running behind them, so they answer
  // here instead - after every check above, exactly as a real app would be
  // reached. Only a deployment the seed created can take this path.
  if (target.provider === "demo") {
    const data = demoAnswer(capability.appSlug, capability.name, validation.value);
    if (data === undefined) {
      const answer = demoReply(404, { error: "Not found" });
      return {
        ok: false,
        error: `${capability.name} failed (404).`,
        status: 404,
        answer,
      };
    }
    return { ok: true, status: 200, data, answer: demoReply(200, data) };
  }

  return call(target, capability, validation.value);
}

interface ResolvedTarget {
  url: URL;
  /** The build being called, so what it answers is recorded against it. */
  deploymentId: string;
  provider: string;
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

  return { url, deploymentId: deployment.id, provider: deployment.provider };
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

  // `/orders/{order_id}` is filled from the input before anything is sent, and
  // the values that went into the address are not sent again. This used to be
  // skipped: the braces went out literally and the id rode along as a query
  // parameter, so every capability with an id in its path answered 404.
  const filled = fillTargetPath(capability.target.path, input);
  if (filled.missing.length > 0) {
    return {
      ok: false,
      error: `Invalid input: ${filled.missing.join(", ")} is required.`,
    };
  }
  // Re-checked with the values in: this is what refuses a value of `..`.
  if (!isSafeTargetPath(filled.path)) {
    return { ok: false, error: "Invalid input: that value cannot go in an address." };
  }
  url.pathname = filled.path;
  const rest = Object.fromEntries(
    Object.entries(input).filter(([key]) => !filled.used.includes(key)),
  );

  if (capability.target.method === "GET") {
    for (const [key, value] of Object.entries(rest)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(
        key,
        typeof value === "object" ? JSON.stringify(value) : String(value),
      );
    }
  } else {
    body = JSON.stringify(rest);
  }

  // Minted for this app's own URL and expiring in an hour, rather than read
  // out of a column. Cloud Run checks the audience before the request reaches
  // the app at all, so a token for one app opens nothing else - and there is
  // no long-lived value anywhere for anyone to take.
  let token: string;
  try {
    token = await deploymentProvider().invocationToken(url.origin);
  } catch {
    return { ok: false, error: `Could not reach ${capability.appName}.` };
  }

  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    // Not `authorization`: Cloud Run consumes this one and passes the
    // app's own `authorization` header through untouched, which matters
    // because the app was not written for Cira and may well use it.
    "x-serverless-authorization": `Bearer ${token}`,
    "x-cira-capability": capability.name,
    ...(body === undefined ? {} : { "content-length": String(body.length) }),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = performance.now();

  let response: Response;
  try {
    response = await fetch(url, {
      method: capability.target.method,
      headers,
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

  const answer: AppAnswer = {
    status: response.status,
    body: text,
    contentType: response.headers.get("content-type"),
    elapsedMs: Math.round(performance.now() - started),
  };

  // A write can only be verified by asking which methods its path allows,
  // and frameworks answer that before they check who is asking - so the app
  // saying no to the real call is the first time anyone could know. It is
  // recorded, so the panel stops offering a switch that leads here and every
  // agent after this one is told why before it tries.
  //
  // Narrow on purpose. A write only: a read was actually called when it was
  // verified and got through, so one 401 now is weaker evidence than what is
  // already known. 401 only: it is about who is calling, where 403 can be
  // about the particular thing asked for. And only while the request spoke for
  // nobody - see `speaksForNobody`.
  if (
    response.status === 401 &&
    capability.risk === "write" &&
    speaksForNobody(headers)
  ) {
    await recordRefusal({
      capabilityId: capability.id,
      deploymentId: target.deploymentId,
    });
    return { ok: false, status: 401, error: refusal(capability), answer };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: `${capability.name} failed (${response.status}).`,
      answer,
    };
  }

  if (text.trim() === "")
    return { ok: true, status: response.status, data: null, answer };

  try {
    return { ok: true, status: response.status, data: JSON.parse(text), answer };
  } catch {
    // A capability is a structured operation. An app answering with HTML is
    // answering a different question, and passing that on to an agent as if it
    // were a result is worse than saying it did not work. The page itself is
    // still in `answer`, for anyone who wants to see what came back.
    return {
      ok: false,
      status: response.status,
      error: `${capability.name} did not return JSON.`,
      answer,
    };
  }
}

/** A demo app's answer, in the shape a real one arrives in. */
function demoReply(status: number, data: unknown): AppAnswer {
  return {
    status,
    body: JSON.stringify(data),
    contentType: "application/json",
    elapsedMs: 0,
  };
}

/** Why an agent cannot run this, for a capability the app turned away. */
function refusal(capability: CapabilityWithApp): string {
  return (
    `${capability.appName} serves ${capability.name} but will not let Cira ` +
    `call it: the app signs its own users in. Nothing in Cira can turn ` +
    `this on.`
  );
}

/**
 * The headers a request may carry and still say nothing about who is asking.
 *
 * Everything Cira sends today, and nothing else. `x-serverless-authorization`
 * is Cira's own service identity, which Cloud Run checks and consumes before
 * the app sees anything; none of the rest identifies anyone.
 */
const ANONYMOUS = new Set([
  "accept",
  "content-type",
  "content-length",
  "x-serverless-authorization",
  "x-cira-capability",
]);

/**
 * Whether a request to an app carried nothing that identifies a person.
 *
 * A refusal is only a fact about the app while that is true. Today Cira calls
 * every app as nobody, so a 401 means Cira itself is shut out. The moment it
 * starts passing someone's identity along - the obvious way to reach an app
 * that signs its own users in - a 401 means that one person was turned away,
 * and recording it would hide the capability from everybody because of them.
 *
 * An allow-list rather than a list of credential headers to look out for,
 * because the change that breaks this will add a header nobody here can
 * predict the name of. Any header not listed switches recording off, and it
 * stays off until somebody decides, here, what the new one means.
 */
export function speaksForNobody(headers: Record<string, string>): boolean {
  return Object.keys(headers).every((name) => ANONYMOUS.has(name.toLowerCase()));
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
