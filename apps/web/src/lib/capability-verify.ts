import "server-only";

import { fillTargetPath, isSafeTargetPath } from "@cira/core";

/**
 * Asking the app whether the capabilities it was credited with are real.
 *
 * Analysis reads source and reasons about it; this is the part that does not
 * reason. The app is the only thing that knows for certain which paths it
 * serves, in any language and behind any framework, and a capability it will
 * not answer for is one an agent would call and get a 404 from.
 *
 * Nothing here calls a write. A `write` is confirmed by asking the path which
 * methods it allows, which cannot change anything; only a `read` is actually
 * invoked, and a read is what an agent is allowed to do unattended anyway, so
 * this is the same request that would have happened first regardless.
 */

/** Long enough for a cold start, short enough that a hung app is not our problem. */
const TIMEOUT_MS = 8_000;

/** Enough to be quick on a large app, few enough not to look like a flood. */
const CONCURRENCY = 6;

/**
 * Stands in for a value the app has never seen.
 *
 * Syntactically ordinary so that routing and validation behave normally, and
 * recognisable in a log so that whoever finds it knows what it was.
 */
const PLACEHOLDER = "cira-probe";

export interface ProbeTarget {
  name: string;
  method: string;
  path: string;
  risk: "read" | "write";
  /** Example input, for reads only. */
  probe?: Record<string, unknown> | undefined;
}

/**
 * What the app said about one capability.
 *
 * Four answers rather than two, because the two hid the interesting ones.
 * `refused` used to be filed as confirmation, and `unknown` used to be filed
 * as absence - so a guarded route was published as ready, and a route that
 * timed out was deleted.
 */
export type Reach = "callable" | "refused" | "absent" | "unknown";

export interface Verification {
  /** The app answered, so Cira can really call these. */
  callable: string[];
  /** The app serves these and would not let Cira through. */
  refused: string[];
  /** The app has no route for these. */
  absent: string[];
  /**
   * True when the app answers everything, so no probe distinguishes anything.
   * Nothing is verified in that case - a catch-all that returns 200 for a path
   * nobody wrote would otherwise confirm every invention.
   */
  inconclusive: boolean;
}

/** An empty answer, for the several ways there is nothing to say. */
const NOTHING: Verification = {
  callable: [],
  refused: [],
  absent: [],
  inconclusive: false,
};

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export async function verifyCapabilities(args: {
  origin: string;
  /** Opens the app. Cira mints this per app; see cloudrun/auth.ts. */
  token: string;
  capabilities: readonly ProbeTarget[];
  /**
   * A signed statement about the person this check is being run for, for an
   * app that asked to be told who is calling. Without it, an app that signs
   * its own users in refuses a probe the same way it refuses a call - which
   * is the right answer for an app that has not opted in, and the wrong one
   * for an app that has.
   */
  identity?: string | undefined;
  fetcher?: Fetcher;
}): Promise<Verification> {
  const fetcher = args.fetcher ?? ((url, init) => fetch(url, init));
  const names = args.capabilities.map((c) => c.name);

  if (args.capabilities.length === 0) return NOTHING;

  // The control comes first, and its failure ends the exercise. Verifying
  // against an app that answers everything is worse than not verifying: it
  // would stamp every hallucination as confirmed.
  const nowhere = `/__cira-probe-${Math.random().toString(36).slice(2, 10)}`;
  const control = await ask(fetcher, args, { method: "GET", path: nowhere });

  // An app that refuses unknown paths as well as real ones tells us nothing
  // by refusing a real one, so the control catches that case too: it comes
  // back 401 rather than 404, and the whole run is inconclusive.
  if (control?.status !== 404) return { ...NOTHING, inconclusive: true };

  // What the app does with OPTIONS on a path it does not serve. Some answer
  // every OPTIONS the same way - CORS middleware in front of everything - and
  // then an `Allow` from a real path is the only thing OPTIONS can say.
  const optionsControl = await allowed(fetcher, args, nowhere);
  const baseline: Baseline = {
    notFound: control,
    nowhere,
    optionsAnswersAnything:
      optionsControl !== null &&
      optionsControl.status !== 404 &&
      optionsControl.status !== 405,
  };

  const callable: string[] = [];
  const refused: string[] = [];
  const absent: string[] = [];

  for (let i = 0; i < args.capabilities.length; i += CONCURRENCY) {
    const batch = args.capabilities.slice(i, i + CONCURRENCY);
    const outcomes = await Promise.all(
      batch.map(async (capability) => ({
        capability,
        reach: await reachOf(fetcher, args, capability, baseline),
      })),
    );

    for (const { capability, reach } of outcomes) {
      // `unknown` lands in none of them on purpose. A capability the app did
      // not answer about stays pending and is asked again next time, which is
      // the difference between a slow app and an app that does not serve it.
      if (reach === "callable") callable.push(capability.name);
      // Turned away while speaking for one person is about that person, and
      // recording it would hide the capability from everybody because of them.
      else if (reach === "refused" && args.identity === undefined) {
        refused.push(capability.name);
      } else if (reach === "absent") absent.push(capability.name);
    }
  }

  void names;
  return { callable, refused, absent, inconclusive: false };
}

/**
 * What does the app say about this?
 *
 * A read is called and a write is only asked which methods it allows, which
 * cannot change anything.
 *
 * The distinction that matters is between a route that is not there and a
 * route that is there and shut. Both used to read as "the request was routed,
 * so the capability is real", and only the first of those is a reason to
 * publish it: an agent handed the second gets a 401 and no idea why.
 */
async function reachOf(
  fetcher: Fetcher,
  args: { origin: string; token: string; identity?: string | undefined },
  capability: ProbeTarget,
  baseline: Baseline,
): Promise<Reach> {
  const path = fill(capability.path, capability.probe);

  // Re-checked here even though nothing malformed should have been stored,
  // because this is the last point before a network call that carries the
  // app's credential. `new URL(path, origin)` ignores the origin entirely when
  // the path is absolute, so an unchecked `https://elsewhere/` would send that
  // credential somewhere else - and this call happens on every deploy with
  // nobody watching.
  if (!isSafeTargetPath(path)) return "absent";

  if (capability.risk === "read") {
    const answer = await ask(fetcher, args, {
      method: capability.method === "HEAD" ? "HEAD" : "GET",
      path: withQuery(path, capability.probe),
    });
    const reach = read(answer, args.origin);
    if (reach !== "absent") return reach;
    // A 404 in the app's own words - "no such customer", "nothing matched" -
    // is its handler answering, whatever the path.
    if (answer !== null && differs(answer, baseline, path)) return "callable";
    if (!hasParameters(capability.path)) return "absent";
    return missingRecordOrRoute(fetcher, args, path, baseline);
  }

  // `Allow` on a 405 is the useful answer: it names the methods this path
  // really serves, and asking for it cannot have changed anything.
  //
  // It is a weaker answer than a read's, and deliberately so. A framework
  // decides a method is wrong before it decides who is asking, so `OPTIONS`
  // comes back with `Allow` whether or not the app would have let Cira post
  // there - measured on Wave, where `/api/v1/beats` advertises `Allow: POST`
  // to an unauthenticated probe and answers 401 to the POST itself. A GET does
  // not separate them either; it is a method mismatch too, so it gets the same
  // 405 from an open path and a guarded one alike.
  //
  // Nothing safe distinguishes the two, and the one thing that would is
  // performing the write, which is the whole point of not doing this by
  // calling. Inferring it from the app's reads was tried on paper and is worse
  // than the gap: an app that guards every read still leaves its sign-up and
  // password-reset routes open, so the inference would mark exactly the
  // capabilities that do work as refused.
  //
  // So `callable` on a write means the app serves this method at this path,
  // and not that Cira got through. That is all `OPTIONS` can prove. The claim
  // is contained by the fact that a write is off until a person turns it on,
  // and the honest place to settle it is the first real invocation.
  const allow = await allowed(fetcher, args, path);
  if (allow === null) return "unknown";
  if (shut(allow.status)) return "refused";
  if (allow.methods.length > 0 && !baseline.optionsAnswersAnything) {
    return allow.methods.includes(capability.method.toUpperCase())
      ? "callable"
      : "absent";
  }
  // A write served on GET - `GET /api/visits` that increments a counter - is
  // the one case where asking with GET is doing it. Measured on production:
  // the check ran the app's counter up. Nothing else is safe to send, so the
  // app is left to say at its first real call.
  if (capability.method === "GET" || capability.method === "HEAD") return "unknown";

  // OPTIONS said nothing useful: no `Allow`, a redirect, a 404, or the same
  // answer it gives a path that does not exist. A 404 used to settle it as
  // absent, but a server that never handles OPTIONS - a plain Node `http`
  // server, measured on production - says 404 to it at every path, and a real
  // `POST /api/notes` beside a working `GET /api/notes` was deleted as a route
  // the app does not serve. The GET below answers 404 for a path that is
  // really not there, so nothing is lost by asking it. A 200 with no `Allow` used to count
  // as callable, which is what a login redirect or a catch-all looks like.
  // A GET asks the same question safely - the write's handler does not run
  // for it - and a route that serves another method says 405.
  const answer = await ask(fetcher, args, { method: "GET", path });
  if (answer === null || isRedirect(answer.status)) return "unknown";
  if (shut(answer.status)) return "refused";
  if (answer.status === 405) return "callable";
  if (answer.status === 404) {
    // `/orders/{id}` can say 404 for the made-up id rather than the route.
    return hasParameters(capability.path) && differs(answer, baseline, path)
      ? "callable"
      : hasParameters(capability.path)
        ? "unknown"
        : "absent";
  }
  // Something answered GET here, so the path is served; whether it takes this
  // method too is for the first real call to settle, as for any write.
  return "callable";
}

/** What the app does with requests for things it does not serve. */
interface Baseline {
  notFound: Answer;
  /** The path it was asked for, which its 404 page may repeat. */
  nowhere: string;
  optionsAnswersAnything: boolean;
}

/** One answer, with enough of it to tell two 404s apart. */
interface Answer {
  status: number;
  contentType: string | null;
  location: string | null;
  /** The start of the body, which is all a comparison needs. */
  body: string;
}

/**
 * `/customers/{id}` answering 404 for the made-up id is usually the record
 * not existing, not the route. Deleting on that removed every read with an id
 * in its path. Past a 404 in the app's own words, which is checked first for
 * every read, the route is taken to exist when OPTIONS finds it; when nothing
 * can tell, it is left unconfirmed and asked again, never deleted.
 */
async function missingRecordOrRoute(
  fetcher: Fetcher,
  args: { origin: string; token: string; identity?: string | undefined },
  path: string,
  baseline: Baseline,
): Promise<Reach> {
  if (!baseline.optionsAnswersAnything) {
    const allow = await allowed(fetcher, args, path);
    if (allow !== null && !isRedirect(allow.status) && !shut(allow.status)) {
      if (allow.status !== 404) return "callable";
    }
  }
  return "unknown";
}

/**
 * Whether a 404 is the app's own words rather than its router's. The path is
 * taken out of both first, because a router's page often repeats it.
 */
function differs(answer: Answer, baseline: Baseline, path: string): boolean {
  return !sameNotFound(
    { ...answer, path },
    { ...baseline.notFound, path: baseline.nowhere },
  );
}

/**
 * Whether two 404s are the same page - the router's, for a path it does not
 * know - once each is stripped of the path it repeats. Invocation uses it too,
 * to tell a route that is gone from a record that is not there.
 */
export function sameNotFound(
  a: { contentType: string | null; body: string; path: string },
  b: { contentType: string | null; body: string; path: string },
): boolean {
  if ((a.contentType ?? "") !== (b.contentType ?? "")) return false;
  const plain = (text: string, own: string) =>
    text.split(own).join("").replace(/\s+/g, " ").trim();
  return plain(a.body, a.path) === plain(b.body, b.path);
}

function hasParameters(path: string): boolean {
  return /\{[^}/]+\}|:[A-Za-z_]/.test(path);
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

/**
 * Where a redirect sends someone to sign in. Anything else - a trailing slash
 * added, a page moved - is not a refusal, and is asked about again.
 */
function toSignIn(location: string | null, origin: string): boolean {
  if (location === null) return false;
  let target: URL;
  try {
    target = new URL(location, origin);
  } catch {
    return false;
  }
  if (target.origin !== new URL(origin).origin) return true;
  return /log-?in|sign-?in|auth|sso|session/i.test(target.pathname);
}

/** What one answer means about a route. */
function read(answer: Answer | null, origin: string): Reach {
  // Not an answer at all. Asked again next time rather than acted on, because
  // the alternative is deleting an app's capabilities because it was briefly
  // slow.
  if (answer === null) return "unknown";
  const { status } = answer;
  if (status === 404) return "absent";
  if (shut(status)) return "refused";
  // A redirect is not a result: a call would get the same one and nothing an
  // agent can use. Sent off to sign in is the app turning Cira away; any
  // other redirect is left unconfirmed rather than published.
  if (isRedirect(status))
    return toSignIn(answer.location, origin) ? "refused" : "unknown";
  // Anything else routed and ran: a 200, a 400 saying the probe value was
  // wrong, even a 500 from inside the handler. All of them prove Cira got
  // through to the app's own code, which is what calling it requires.
  return "callable";
}

/**
 * Is this the app turning Cira away at its own door?
 *
 * 401 and 403 only. Cloud Run answers 403 before the app sees anything when
 * the token is wrong, but that fails the control probe first and the whole run
 * is inconclusive, so a 403 reaching here came from the app.
 */
function shut(status: number): boolean {
  return status === 401 || status === 403;
}

/** Enough of a body to tell one 404 page from another. */
const BODY_SAMPLE_BYTES = 4096;

async function ask(
  fetcher: Fetcher,
  args: { origin: string; token: string; identity?: string | undefined },
  request: { method: string; path: string },
): Promise<Answer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetcher(new URL(request.path, args.origin).toString(), {
      method: request.method,
      headers: {
        // Cloud Run consumes this and leaves the app's own `authorization`
        // header alone; see invoke-capability.ts.
        "x-serverless-authorization": `Bearer ${args.token}`,
        "x-cira-probe": "1",
        accept: "application/json",
        ...(args.identity === undefined ? {} : { "x-cira-identity": args.identity }),
      },
      redirect: "manual",
      signal: controller.signal,
    });
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      location: response.headers.get("location"),
      // Read under the same deadline: an app that sends headers and then
      // trickles its body does not hold the check open.
      body: response.status === 404 ? await sample(response) : "",
    };
  } catch {
    // Unreachable is not the same as absent, and treating it as absent would
    // delete an app's capabilities because it was briefly slow.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The start of a body, then the rest let go. */
async function sample(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < BODY_SAMPLE_BYTES) {
    const { done, value } = await reader.read();
    if (done || value === undefined) break;
    chunks.push(value);
    size += value.byteLength;
  }
  void reader.cancel().catch(() => undefined);
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes.subarray(0, BODY_SAMPLE_BYTES));
}

async function allowed(
  fetcher: Fetcher,
  args: { origin: string; token: string },
  path: string,
): Promise<{ status: number; methods: string[] } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetcher(new URL(path, args.origin).toString(), {
      method: "OPTIONS",
      headers: {
        "x-serverless-authorization": `Bearer ${args.token}`,
        "x-cira-probe": "1",
      },
      redirect: "manual",
      signal: controller.signal,
    });

    const header = response.headers.get("allow") ?? "";
    return {
      status: response.status,
      methods: header
        .split(",")
        .map((m) => m.trim().toUpperCase())
        .filter((m) => m !== ""),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Put the example's values, or something harmless, where path parameters go.
 * The same rule invocation uses, so a route is asked about at the address it
 * will really be called at.
 */
function fill(path: string, probe: Record<string, unknown> | undefined): string {
  return fillTargetPath(path, probe ?? {}, PLACEHOLDER).path;
}

/** A read's example input, as query parameters. */
function withQuery(path: string, probe: Record<string, unknown> | undefined): string {
  if (probe === undefined) return path;

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(probe)) {
    if (path.includes(encodeURIComponent(String(value)))) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === "object") continue;
    query.set(key, String(value));
  }

  const suffix = query.toString();
  return suffix === "" ? path : `${path}?${suffix}`;
}
