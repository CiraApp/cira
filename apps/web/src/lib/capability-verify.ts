import "server-only";

import { isSafeTargetPath } from "@cira/core";

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
  fetcher?: Fetcher;
}): Promise<Verification> {
  const fetcher = args.fetcher ?? ((url, init) => fetch(url, init));
  const names = args.capabilities.map((c) => c.name);

  if (args.capabilities.length === 0) return NOTHING;

  // The control comes first, and its failure ends the exercise. Verifying
  // against an app that answers everything is worse than not verifying: it
  // would stamp every hallucination as confirmed.
  const control = await ask(fetcher, args, {
    method: "GET",
    path: `/__cira-probe-${Math.random().toString(36).slice(2, 10)}`,
  });

  // An app that refuses unknown paths as well as real ones tells us nothing
  // by refusing a real one, so the control catches that case too: it comes
  // back 401 rather than 404, and the whole run is inconclusive.
  if (control !== 404) return { ...NOTHING, inconclusive: true };

  const callable: string[] = [];
  const refused: string[] = [];
  const absent: string[] = [];

  for (let i = 0; i < args.capabilities.length; i += CONCURRENCY) {
    const batch = args.capabilities.slice(i, i + CONCURRENCY);
    const outcomes = await Promise.all(
      batch.map(async (capability) => ({
        capability,
        reach: await reachOf(fetcher, args, capability),
      })),
    );

    for (const { capability, reach } of outcomes) {
      // `unknown` lands in none of them on purpose. A capability the app did
      // not answer about stays pending and is asked again next time, which is
      // the difference between a slow app and an app that does not serve it.
      if (reach === "callable") callable.push(capability.name);
      else if (reach === "refused") refused.push(capability.name);
      else if (reach === "absent") absent.push(capability.name);
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
  args: { origin: string; token: string },
  capability: ProbeTarget,
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
    const status = await ask(fetcher, args, {
      method: capability.method === "HEAD" ? "HEAD" : "GET",
      path: withQuery(path, capability.probe),
    });
    return read(status);
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
  if (allow.status === 404) return "absent";
  if (allow.methods.length === 0) return "callable";
  return allow.methods.includes(capability.method.toUpperCase()) ? "callable" : "absent";
}

/** What one status code means about a route. */
function read(status: number | null): Reach {
  // Not an answer at all. Asked again next time rather than acted on, because
  // the alternative is deleting an app's capabilities because it was briefly
  // slow.
  if (status === null) return "unknown";
  if (status === 404) return "absent";
  if (shut(status)) return "refused";
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

async function ask(
  fetcher: Fetcher,
  args: { origin: string; token: string },
  request: { method: string; path: string },
): Promise<number | null> {
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
      },
      redirect: "manual",
      signal: controller.signal,
    });
    return response.status;
  } catch {
    // Unreachable is not the same as absent, and treating it as absent would
    // delete an app's capabilities because it was briefly slow.
    return null;
  } finally {
    clearTimeout(timer);
  }
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

/** Put something harmless where a path parameter goes. */
function fill(path: string, probe: Record<string, unknown> | undefined): string {
  return path.replace(/\{([^}]+)\}|:([A-Za-z_][A-Za-z0-9_]*)/g, (_, braced, colon) => {
    const key = (braced ?? colon) as string;
    const given = probe?.[key];
    const value =
      typeof given === "string" || typeof given === "number"
        ? String(given)
        : PLACEHOLDER;
    return encodeURIComponent(value);
  });
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
