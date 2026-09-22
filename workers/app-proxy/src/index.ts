import { parseAppHost, verifySession } from "@cira/core";

/**
 * The way in to a deployed app.
 *
 * Apps run on Cloud Run, which is private: it wants a Google identity token on
 * every request and refuses anything without one. A browser cannot put a
 * header on a navigation, so something has to stand between the person and the
 * app and add it. This is that something.
 *
 * It decides nothing. Cira decides who may open which app and says so by
 * signing a short-lived token; all that happens here is a signature check and
 * a forward. That division is the point - the proxy sees every request, so the
 * less it is trusted to reason about, the better.
 *
 * Why a hostname per app rather than a path per app: an app asks for its own
 * assets at absolute paths like `/_next/static/x.js`, and under a shared
 * hostname those would resolve to whichever app was serving the root. Giving
 * each app an origin also stops one app's JavaScript reading another's
 * storage, which a shared origin would allow.
 */

export interface Env {
  /** Where Cira itself answers, e.g. `https://cira.dev`. */
  CIRA_ORIGIN: string;
  /** Apps answer at `{app}--{space}.{APPS_DOMAIN}`. */
  APPS_DOMAIN: string;
  /** Shared with Cira. Used to verify signatures, and to ask for a token. */
  CIRA_PROXY_SECRET: string;
}

/**
 * Host-scoped by construction. The `__Host-` prefix forbids a `Domain`
 * attribute, so a browser will not send this to any other app's hostname even
 * if something tried to set it that way.
 */
const COOKIE = "__Host-cira";

/** Where the handshake lands. Under a reserved path an app cannot claim. */
const ENTER_PATH = "/__cira/enter";

interface Reachable {
  origin: string;
  token: string;
  /** Unix milliseconds. */
  expiresAt: number;
}

/**
 * One entry per app, per isolate. Identity tokens last an hour and are the
 * same for every person using an app, so fetching one per request would be a
 * round trip to Cira for every image on a page. A miss costs one call.
 */
const reachable = new Map<string, Reachable>();

/**
 * A company's own hostnames, by the label of the app each opens. Null for a
 * name that opens nothing, so a stranger's guesses cost Cira one call each at
 * most every few minutes.
 */
const domains = new Map<string, { label: string | null; until: number }>();
const DOMAIN_FOR_MS = 5 * 60 * 1000;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const hostname = url.hostname.toLowerCase();
    const own = parseAppHost(hostname, env.APPS_DOMAIN);

    // A Cira address carries its label; a company's own name - which reaches
    // this Worker as a Cloudflare custom hostname - is asked about. Anything
    // else under the domain without a record of its own also arrives here,
    // and there is nothing to serve it. Cira's own names have records of their
    // own and do not reach this, which is why they must stay unproxied.
    const label =
      own !== null
        ? (hostname.split(".")[0] ?? "")
        : hostname.endsWith(`.${env.APPS_DOMAIN}`)
          ? null
          : await domainLabel(hostname, env).catch(() => null);
    if (label === null) {
      return new Response("No app at this address.", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    // Asked for by name only when the name is not Cira's own address, so the
    // handshake comes back to the name the person used.
    const host = own === null ? hostname : null;

    if (url.pathname === ENTER_PATH) return enter(url, label, host, env);

    const session = await currentSession(request, label, env);
    if (session === null) {
      return challenge(request, `${url.pathname}${url.search}`, label, host, env);
    }

    return forward(request, url, label, env);
  },
};

/** Which app a company's own hostname opens, asked of Cira and remembered. */
async function domainLabel(hostname: string, env: Env): Promise<string | null> {
  const held = domains.get(hostname);
  if (held !== undefined && held.until > Date.now()) return held.label;

  const response = await fetch(new URL("/api/proxy/domain", env.CIRA_ORIGIN), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-cira-proxy-secret": env.CIRA_PROXY_SECRET,
    },
    body: JSON.stringify({ hostname }),
  });
  // Only a clear answer is remembered. Cira being unreachable is not "no app".
  if (response.status !== 200 && response.status !== 404) {
    throw new Error(`Cira did not answer about ${hostname} (${response.status})`);
  }
  const body = (await response.json().catch(() => ({}))) as { label?: unknown };
  const label = typeof body.label === "string" ? body.label : null;
  domains.set(hostname, { label, until: Date.now() + DOMAIN_FOR_MS });
  return label;
}

/** Read and check the cookie this host was given. */
async function currentSession(
  request: Request,
  label: string,
  env: Env,
): Promise<{ userId: string } | null> {
  const token = readCookie(request.headers.get("cookie"), COOKIE);
  if (token === null) return null;
  return verifySession(token, env.CIRA_PROXY_SECRET, { label });
}

/**
 * Finish the handshake: Cira has vouched for this person, so put the proof in
 * a cookie for this hostname and get out of the way.
 */
async function enter(
  url: URL,
  label: string,
  host: string | null,
  env: Env,
): Promise<Response> {
  const token = url.searchParams.get("t") ?? "";
  const session = await verifySession(token, env.CIRA_PROXY_SECRET, { label });
  const next = safePath(url.searchParams.get("next"));

  // A bad token here means a stale or tampered link, and sending someone back
  // to Cira is both the honest answer and the one that fixes it - but back to
  // where they were going, not back to this handshake. Asking Cira to return
  // them to a URL containing the token that just failed is a loop.
  if (session === null) return challenge(null, next, label, host, env);
  const maxAge = Math.max(0, session.expiresAt - Math.floor(Date.now() / 1000));

  return new Response(null, {
    status: 302,
    headers: {
      location: next,
      // The token is never readable by the app's own scripts, and never
      // travels to another site.
      "set-cookie": `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`,
      "cache-control": "no-store",
    },
  });
}

/**
 * No usable session. Send a person to Cira to get one; tell anything else
 * plainly that it is not allowed.
 *
 * The distinction matters. Redirecting a stylesheet or an XHR to a sign-in
 * page produces a page where half the assets are HTML and nothing says why.
 */
function challenge(
  request: Request | null,
  next: string,
  label: string,
  /** The company's own name the person used, when it was not Cira's address. */
  host: string | null,
  env: Env,
): Response {
  const navigation =
    request === null ||
    request.headers.get("sec-fetch-mode") === "navigate" ||
    (request.headers.get("accept") ?? "").includes("text/html");

  if (!navigation) {
    return new Response("Not signed in", {
      status: 401,
      headers: { "cache-control": "no-store" },
    });
  }

  const enterUrl = new URL(`/enter/${label}`, env.CIRA_ORIGIN);
  enterUrl.searchParams.set("next", next);
  if (host !== null) enterUrl.searchParams.set("host", host);

  return new Response(null, {
    status: 302,
    headers: { location: enterUrl.toString(), "cache-control": "no-store" },
  });
}

/** Hand the request to the app, with the credential it insists on. */
async function forward(
  request: Request,
  url: URL,
  label: string,
  env: Env,
): Promise<Response> {
  let target: Reachable;
  try {
    target = await reach(label, env);
  } catch {
    return new Response("That app is not reachable right now.", { status: 502 });
  }

  const upstream = new URL(url.pathname + url.search, target.origin);

  const headers = new Headers(request.headers);
  // Cira's own credential, on every request. Not `authorization`: Cloud Run
  // consumes this one and leaves the app's alone, which matters because the
  // app was not written for Cira and may use it for something.
  headers.set("x-serverless-authorization", `Bearer ${target.token}`);
  // The app has no business seeing the cookie that got someone in here.
  const cookies = stripCookie(request.headers.get("cookie"), COOKIE);
  if (cookies === null) headers.delete("cookie");
  else headers.set("cookie", cookies);
  headers.set("x-forwarded-host", url.hostname);
  headers.set("x-forwarded-proto", "https");

  // Streamed, not buffered: an app that sends events or a large download
  // should not be held in memory here, and buffering would break it.
  return fetch(
    new Request(upstream, {
      method: request.method,
      headers,
      body: request.body,
      redirect: "manual",
    }),
  );
}

/** Where an app lives and what opens it, asked of Cira and remembered. */
async function reach(label: string, env: Env): Promise<Reachable> {
  const held = reachable.get(label);
  if (held !== undefined && held.expiresAt > Date.now() + 60_000) return held;

  const response = await fetch(new URL("/api/proxy/token", env.CIRA_ORIGIN), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-cira-proxy-secret": env.CIRA_PROXY_SECRET,
    },
    body: JSON.stringify({ label }),
  });

  if (!response.ok) throw new Error(`Cira refused a token (${response.status})`);

  const body = (await response.json()) as { token?: unknown; origin?: unknown };
  if (typeof body.token !== "string" || typeof body.origin !== "string") {
    throw new Error("Cira returned no usable token");
  }

  // Identity tokens last an hour; this is trimmed well short so one is never
  // used in the minute it expires.
  const entry: Reachable = {
    origin: body.origin,
    token: body.token,
    expiresAt: Date.now() + 45 * 60 * 1000,
  };
  reachable.set(label, entry);
  return entry;
}

function readCookie(header: string | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || null;
  }
  return null;
}

function stripCookie(header: string | null, name: string): string | null {
  if (header === null) return null;
  const kept = header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => !part.startsWith(`${name}=`));
  return kept.length === 0 ? null : kept.join("; ");
}

/** Only ever somewhere inside this app. A path from a query parameter that is
 * not checked is an open redirect. */
function safePath(value: string | null): string {
  if (value === null || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}
