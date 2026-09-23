import "server-only";

import { deploymentProvider } from "@cira/deploy";
import { and, count, eq, gt } from "drizzle-orm";
import { db, invocations } from "@cira/db";
import {
  DEFAULT_LIMITS,
  checkInvocationRate,
  fillTargetPath,
  isSafeTargetPath,
  newId,
  type Capability,
  type User,
} from "@cira/core";
import {
  getCapabilityForUser,
  recordAbsence,
  recordAnswered,
  recordRefusal,
  NO_SUCH_CAPABILITY,
  type CapabilityWithApp,
} from "@/lib/capabilities";
import { assertIdentity, IDENTITY_HEADER } from "@/lib/identity-assertion";
import { servingDeployment } from "@/lib/queries";
import { validateInput } from "@/lib/json-schema";
import { sameNotFound } from "@/lib/capability-verify";
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

/** Where a run came from, for the record of who ran what. */
export type InvocationVia = "mcp" | "ask" | "console";

type Outcome = (typeof invocations.$inferInsert)["outcome"];

export async function invokeCapability(args: {
  user: User;
  capabilityId: string;
  input: unknown;
  via: InvocationVia;
  /** The approval its person gave for this run, when it needed one. */
  approvalId?: string | undefined;
}): Promise<InvocationResult> {
  // Resolves the acting user from the session and applies app access. A
  // capability the caller cannot see reads as one that does not exist, and is
  // not recorded either: a row naming it would say that it does.
  const capability = await getCapabilityForUser(args.user, args.capabilityId);
  if (capability === null) return { ok: false, error: NO_SUCH_CAPABILITY };

  // One person can only start so many runs a minute, across MCP, Ask Cira and
  // the console together, since each is a request to somebody's app. The run
  // is written down first and counted with itself in: counting and then
  // writing let every one of a burst of parallel calls see the same count and
  // pass together. A run the limit refuses is taken back out of the record.
  const runId = await claimRun({
    capability,
    user: args.user,
    via: args.via,
    approvalId: args.approvalId ?? null,
  });
  const limit = checkInvocationRate(
    (await runsInLastMinute(args.user.id)) - 1,
    DEFAULT_LIMITS,
  );
  if (!limit.ok) {
    await db().delete(invocations).where(eq(invocations.id, runId));
    return { ok: false, error: limit.message };
  }

  const { result, outcome } = await attempt(capability, args.input, {
    user: args.user,
    via: args.via,
  });
  await record(runId, capability, outcome, result);
  return result;
}

/** Every check after access, and the call itself, with how it ended. */
async function attempt(
  capability: CapabilityWithApp,
  input: unknown,
  /** Who is asking, for an app that has asked to be told. */
  caller: { user: User; via: InvocationVia },
): Promise<{ result: InvocationResult; outcome: Outcome }> {
  // Asked before `enabled`, because `enabled` is false for both of these and
  // the sentence it offers - go and ask an admin - is only true for one of
  // them. Telling an agent to get a refused capability switched on sends it
  // after something nobody can do.
  if (capability.reach === "refused") {
    return { result: { ok: false, error: refusal(capability) }, outcome: "refused" };
  }

  if (capability.reach === "pending") {
    return {
      result: {
        ok: false,
        error: `Cira has not confirmed ${capability.name} with ${capability.appName} yet.`,
      },
      outcome: "pending",
    };
  }

  if (!capability.enabled) {
    return {
      result: {
        ok: false,
        error: `${capability.name} is registered but not enabled. An admin can turn it on from the app's page.`,
      },
      outcome: "disabled",
    };
  }

  const validation = validateInput(capability.inputSchema, input);
  if (!validation.ok) {
    return {
      result: { ok: false, error: `Invalid input: ${validation.error}` },
      outcome: "invalid-input",
    };
  }

  const target = await resolveTarget(capability);
  if (target === null) {
    return {
      result: { ok: false, error: `${capability.appName} is not reachable right now.` },
      outcome: "unreachable",
    };
  }

  // The demo company's apps have nothing running behind them, so they answer
  // here instead - after every check above, exactly as a real app would be
  // reached. Only a deployment the seed created can take this path.
  if (target.provider === "demo") {
    const data = demoAnswer(capability.appSlug, capability.name, validation.value);
    if (data === undefined) {
      const answer = demoReply(404, { error: "Not found" });
      return {
        result: {
          ok: false,
          error: `${capability.name} failed (404).`,
          status: 404,
          answer,
        },
        outcome: "ran",
      };
    }
    return {
      result: { ok: true, status: 200, data, answer: demoReply(200, data) },
      outcome: "ran",
    };
  }

  // `/orders/{order_id}` is filled from the input before anything is sent, and
  // the values that went into the address are not sent again. This used to be
  // skipped: the braces went out literally and the id rode along as a query
  // parameter, so every capability with an id in its path answered 404.
  const filled = fillTargetPath(capability.target.path, validation.value);
  if (filled.missing.length > 0) {
    return {
      result: {
        ok: false,
        error: `Invalid input: ${filled.missing.join(", ")} is required.`,
      },
      outcome: "invalid-input",
    };
  }
  // Re-checked with the values in: this is what refuses a value of `..`.
  if (!isSafeTargetPath(filled.path)) {
    return {
      result: { ok: false, error: "Invalid input: that value cannot go in an address." },
      outcome: "invalid-input",
    };
  }

  const result = await call(target, capability, validation.value, filled, caller);
  // Past the checks, the only way not to have the app's answer is not to have
  // reached it: a timeout, no connection, a token that could not be minted.
  return { result, outcome: result.answer !== undefined ? "ran" : "unreachable" };
}

/** How many runs this person started in the last sixty seconds. */
async function runsInLastMinute(userId: string): Promise<number> {
  const [row] = await db()
    .select({ n: count() })
    .from(invocations)
    .where(
      and(
        eq(invocations.userId, userId),
        gt(invocations.createdAt, new Date(Date.now() - 60_000)),
      ),
    );
  return row?.n ?? 0;
}

/**
 * Write down that a run started: who, what, from where, and on whose
 * approval; never the input. Until it ends it reads as a run with no answer,
 * which is also the truth about one whose function was killed mid-call.
 */
async function claimRun(args: {
  capability: CapabilityWithApp;
  user: User;
  via: InvocationVia;
  approvalId: string | null;
}): Promise<string> {
  const id = newId("invocation");
  await db().insert(invocations).values({
    id,
    spaceId: args.capability.spaceId,
    appId: args.capability.appId,
    capabilityId: args.capability.id,
    capabilityName: args.capability.name,
    userId: args.user.id,
    via: args.via,
    approvalId: args.approvalId,
    outcome: "ran",
  });
  return id;
}

/**
 * Write down how it ended; never the reply.
 *
 * A failure to write is logged rather than thrown. By now the app has been
 * called, and telling the person it failed when it did not would be the worse
 * of the two outcomes - they would run a refund again.
 */
async function record(
  runId: string,
  capability: CapabilityWithApp,
  outcome: Outcome,
  result: InvocationResult,
): Promise<void> {
  const answer = result.answer;
  try {
    await db()
      .update(invocations)
      .set({
        outcome,
        status: answer?.status ?? null,
        elapsedMs: answer?.elapsedMs ?? null,
      })
      .where(eq(invocations.id, runId));
  } catch (error) {
    console.error(
      `could not record a run of ${capability.id}: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }
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

  // The newest build that went live, not the newest build. While a new one
  // is building, or after one failed, the last good one is still what is
  // serving - traffic stays on it - and its capabilities still work.
  const deployment = await servingDeployment(capability.appId);
  if (deployment === null || deployment.url === null) return null;

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
 * A GET, HEAD or DELETE carries its input as query parameters and anything
 * else as a JSON body, because that is what an ordinary route already expects
 * - the whole premise is that the app was not written for Cira. A list in a
 * query is the same key once per item (`?tag=a&tag=b`), the way every
 * framework reads one; it used to go as one JSON string nothing parsed.
 */
async function call(
  target: ResolvedTarget,
  capability: CapabilityWithApp,
  input: Record<string, unknown>,
  /** The path with the input's values in it, already checked. */
  filled: { path: string; used: readonly string[] },
  caller: { user: User; via: InvocationVia },
): Promise<InvocationResult> {
  const url = new URL(target.url);
  let body: string | undefined;

  url.pathname = filled.path;
  const rest = Object.fromEntries(
    Object.entries(input).filter(([key]) => !filled.used.includes(key)),
  );

  if (inQuery(capability.target.method)) {
    for (const [key, value] of queryPairs(rest)) url.searchParams.append(key, value);
  } else {
    // A body, except for what the capability says the app reads from the
    // query string - a POST with `?dry_run=true` is not rare.
    const inAddress = queryFields(capability.inputSchema);
    const query = Object.fromEntries(
      Object.entries(rest).filter(([k]) => inAddress.has(k)),
    );
    for (const [key, value] of queryPairs(query)) url.searchParams.append(key, value);
    body = JSON.stringify(
      Object.fromEntries(Object.entries(rest).filter(([k]) => !inAddress.has(k))),
    );
  }
  const write = capability.risk === "write";

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

  // Who is asking, signed, and only for an app whose managers asked to be
  // told. Every other app is called exactly as before: as nobody.
  const identity = capability.appTellsWhoIsCalling
    ? assertIdentity({
        user: caller.user,
        spaceSlug: capability.spaceSlug,
        audience: url.origin,
        via: caller.via,
      })
    : null;

  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    ...(identity === null ? {} : { [IDENTITY_HEADER]: identity }),
    // Not `authorization`: Cloud Run consumes this one and passes the
    // app's own `authorization` header through untouched, which matters
    // because the app was not written for Cira and may well use it.
    "x-serverless-authorization": `Bearer ${token}`,
    "x-cira-capability": capability.name,
    // In bytes. The string's length counts characters, and a body with an
    // accent or a name in another script is longer than that on the wire.
    ...(body === undefined
      ? {}
      : { "content-length": String(Buffer.byteLength(body, "utf8")) }),
  };

  // One deadline for the whole answer, body included. It used to stop at the
  // headers, so an app that sent them and then trickled its body held the
  // call open until the platform killed the function, and nothing recorded
  // what happened.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = performance.now();
  const late = `${capability.name} took longer than ${TIMEOUT_MS / 1000} seconds.`;

  let response: Response;
  let text: string | null;
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
    if (!aborted) return { ok: false, error: `Could not reach ${capability.appName}.` };
    return { ok: false, error: write ? `${late} ${MAY_HAVE_HAPPENED}` : late };
  }

  try {
    text = await readCapped(response);
  } catch {
    clearTimeout(timer);
    // The app answered, so a write reached its code; only the rest of what
    // it said is missing.
    const answer = replyOf(response, "", started);
    return {
      ok: false,
      status: response.status,
      error: write ? `${late} ${MAY_HAVE_HAPPENED}` : late,
      answer,
    };
  }
  clearTimeout(timer);

  // A redirect from a read is the app asking for a login it should never
  // need, or pointing somewhere else entirely; neither is worth following. A
  // write redirecting afterwards is often how it says it worked (a 303 to the
  // thing it made), so it is never reported as not having happened.
  if (response.status >= 300 && response.status < 400) {
    const answer = replyOf(response, text ?? "", started);
    return write
      ? {
          ok: false,
          status: response.status,
          error: `${capability.appName} answered ${capability.name} with a redirect, not a result. ${MAY_HAVE_HAPPENED}`,
          answer,
        }
      : { ok: false, error: `${capability.name} did not return a result.`, answer };
  }

  if (text === null) {
    const answer = replyOf(response, "", started);
    return write && response.ok
      ? {
          ok: true,
          status: response.status,
          data: { accepted: true, note: "The app's answer was too large to pass on." },
          answer,
        }
      : { ok: false, error: `${capability.name} returned too much data.`, answer };
  }

  const answer = replyOf(response, text, started);

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

  // A 404 is usually the thing asked for not existing - no such order - and
  // then it is the app's own answer. Only when it is the very page the app
  // gives for a path nobody wrote is the route itself gone, and the
  // capability is sent back to be checked before anyone else is offered it.
  if (
    response.status === 404 &&
    fillTargetPath(capability.target.path, {}).missing.length === 0 &&
    (await routerSaidIt(url, answer, headers))
  ) {
    await recordAbsence(capability.id);
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: `${capability.name} failed (${response.status}).`,
      answer,
    };
  }

  if (text.trim() === "") {
    // A write that answered 2xx with nothing reached its handler; a read that
    // answered nothing proves little, so it settles nothing.
    if (write) await settle(capability, target.deploymentId);
    return { ok: true, status: response.status, data: null, answer };
  }

  try {
    const data: unknown = JSON.parse(text);
    // A result in JSON is the app's own code answering. A catch-all's page
    // is HTML, so this cannot be one confirming a route nobody wrote.
    await settle(capability, target.deploymentId);
    return { ok: true, status: response.status, data, answer };
  } catch {
    // A write that the app accepted happened, whatever it answered with.
    // Calling it a failure invites the same refund again.
    if (write) {
      return {
        ok: true,
        status: response.status,
        data: { accepted: true, note: "The app did not answer with JSON." },
        answer,
      };
    }
    // A capability is a structured operation. An app answering a read with
    // HTML is answering a different question, and passing that on to an agent
    // as if it were a result is worse than saying it did not work. The page
    // itself is still in `answer`, for anyone who wants to see what came back.
    return {
      ok: false,
      status: response.status,
      error: `${capability.name} did not return JSON.`,
      answer,
    };
  }
}

/**
 * Whether a 404 is the router's rather than the handler's: the same page, in
 * the same type, that the app gives a path it has never heard of. One more
 * small request, and only after a 404; a failure to ask counts as no.
 */
/**
 * A real call is what settles a capability the app could not confirm by being
 * asked; see `recordAnswered`. Only ever for one in that state, so every
 * other call costs nothing here.
 */
async function settle(capability: CapabilityWithApp, deploymentId: string) {
  if (capability.reach !== "unconfirmed") return;
  try {
    await recordAnswered({ capabilityId: capability.id, deploymentId });
  } catch {
    // Bookkeeping. The call worked and its result is on its way; failing to
    // note that is no reason to report the call as anything else.
  }
}

async function routerSaidIt(
  url: URL,
  answer: AppAnswer,
  headers: Record<string, string>,
): Promise<boolean> {
  const nowhere = new URL(url);
  nowhere.pathname = `/__cira-probe-${Math.random().toString(36).slice(2, 10)}`;
  nowhere.search = "";
  try {
    const control = await fetch(nowhere, {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-serverless-authorization": headers["x-serverless-authorization"] ?? "",
      },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (control.status !== 404) return false;
    const body = ((await readCapped(control)) ?? "").slice(0, 4096);
    return sameNotFound(
      {
        contentType: answer.contentType,
        body: answer.body.slice(0, 4096),
        path: url.pathname,
      },
      { contentType: control.headers.get("content-type"), body, path: nowhere.pathname },
    );
  } catch {
    return false;
  }
}

/** What to tell anyone about a write whose result Cira could not see. */
const MAY_HAVE_HAPPENED =
  "The change may still have been made: check in the app before trying again.";

/** The properties a schema marks as read from the query string. */
function queryFields(schema: Record<string, unknown>): Set<string> {
  const properties = schema["properties"];
  if (properties === null || typeof properties !== "object") return new Set();
  return new Set(
    Object.entries(properties as Record<string, unknown>)
      .filter(
        ([, value]) =>
          value !== null &&
          typeof value === "object" &&
          (value as Record<string, unknown>)["x-cira-in"] === "query",
      )
      .map(([key]) => key),
  );
}

/** Methods whose input goes in the address, since they carry no body. */
function inQuery(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "DELETE";
}

/**
 * Input as query parameters. A list is its key once per item; anything else
 * that is not a plain value goes as JSON, which is the least surprising of
 * the bad choices for a nested object.
 */
export function queryPairs(input: Record<string, unknown>): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) continue;
        pairs.push([key, typeof item === "object" ? JSON.stringify(item) : String(item)]);
      }
      continue;
    }
    pairs.push([key, typeof value === "object" ? JSON.stringify(value) : String(value)]);
  }
  return pairs;
}

function replyOf(response: Response, body: string, started: number): AppAnswer {
  return {
    status: response.status,
    body,
    contentType: response.headers.get("content-type"),
    elapsedMs: Math.round(performance.now() - started),
  };
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
