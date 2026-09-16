import "server-only";

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

export interface Verification {
  /** Names the app answered for. */
  verified: string[];
  /** Names the app has no route for. */
  rejected: string[];
  /**
   * True when the app answers everything, so no probe distinguishes anything.
   * Nothing is verified in that case - a catch-all that returns 200 for a path
   * nobody wrote would otherwise confirm every invention.
   */
  inconclusive: boolean;
}

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

  if (args.capabilities.length === 0) {
    return { verified: [], rejected: [], inconclusive: false };
  }

  // The control comes first, and its failure ends the exercise. Verifying
  // against an app that answers everything is worse than not verifying: it
  // would stamp every hallucination as confirmed.
  const control = await ask(fetcher, args, {
    method: "GET",
    path: `/__cira-probe-${Math.random().toString(36).slice(2, 10)}`,
  });

  if (control !== 404) {
    return { verified: [], rejected: [], inconclusive: true };
  }

  const verified: string[] = [];
  const rejected: string[] = [];

  for (let i = 0; i < args.capabilities.length; i += CONCURRENCY) {
    const batch = args.capabilities.slice(i, i + CONCURRENCY);
    const outcomes = await Promise.all(
      batch.map(async (capability) => ({
        capability,
        exists: await exists(fetcher, args, capability),
      })),
    );

    for (const { capability, exists: ok } of outcomes) {
      (ok ? verified : rejected).push(capability.name);
    }
  }

  void names;
  return { verified, rejected, inconclusive: false };
}

/**
 * Does the app serve this?
 *
 * A read is called; anything but 404 means the route is there, because an app
 * refusing on its own authentication, or failing inside a handler, has still
 * routed the request. A write is only asked which methods it allows.
 */
async function exists(
  fetcher: Fetcher,
  args: { origin: string; token: string },
  capability: ProbeTarget,
): Promise<boolean> {
  const path = fill(capability.path, capability.probe);

  if (capability.risk === "read") {
    const status = await ask(fetcher, args, {
      method: capability.method === "HEAD" ? "HEAD" : "GET",
      path: withQuery(path, capability.probe),
    });
    return status !== null && status !== 404;
  }

  // `Allow` on a 405 is the useful answer: it names the methods this path
  // really serves, and asking for it cannot have changed anything.
  const allow = await allowed(fetcher, args, path);
  if (allow === null) return false;
  if (allow.status === 404) return false;
  if (allow.methods.length === 0) return true;
  return allow.methods.includes(capability.method.toUpperCase());
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
