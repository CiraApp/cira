import "server-only";

/**
 * Asking the app whether a browser has any business opening it.
 *
 * An API is not a website. It serves JSON, it has no homepage, and its root
 * answers 404 - so offering someone an "Open" button for it produces exactly
 * the experience of clicking a door and finding a wall. Cira knows enough to
 * avoid that, but only by asking: the source does not reliably say, and a
 * framework that serves pages is indistinguishable from one that serves JSON
 * until it is running.
 *
 * So this asks the same way capability verification does - one request to the
 * deployed app, with the credential that opens it - and believes the answer
 * over anything read from the code.
 */

/** Long enough for a cold start, short enough that a hung app is not our problem. */
const TIMEOUT_MS = 8_000;

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/**
 * True when the app serves a browser, false when it plainly does not, and null
 * when the answer was not clear enough to act on.
 *
 * Null is the important third case and it is common: an app that demands its
 * own authentication at the root, one that is briefly unreachable, one that
 * errors. None of those mean "no web interface", and treating them that way
 * would take the way into a working app away from everybody. The caller leaves
 * what it already knew alone.
 */
export async function probeWebUi(args: {
  origin: string;
  /** Opens the app. Cira mints this per app; see cloudrun/auth.ts. */
  token: string;
  fetcher?: Fetcher;
}): Promise<boolean | null> {
  const fetcher = args.fetcher ?? ((url, init) => fetch(url, init));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetcher(new URL("/", args.origin).toString(), {
      method: "GET",
      headers: {
        // Cloud Run consumes this and leaves the app's own `authorization`
        // header alone; see invoke-capability.ts.
        "x-serverless-authorization": `Bearer ${args.token}`,
        "x-cira-probe": "1",
        // Asking for HTML rather than JSON, unlike every other probe Cira
        // sends. An app that negotiates on `Accept` would hand back JSON to a
        // request that asked for JSON and look like it had no front door when
        // it has a perfectly good one.
        accept: "text/html,application/xhtml+xml",
      },
      // A redirect is the answer, not something to follow. `/` sending a
      // browser to `/login` is a front door behaving normally, and chasing it
      // would only turn one clear signal into another request that might not
      // be clear at all.
      redirect: "manual",
      signal: controller.signal,
    });

    return readAnswer(response);
  } catch {
    // Unreachable is not the same as absent.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function readAnswer(response: Response): boolean | null {
  const status = response.status;

  // Something is at the root and it wants a browser to go there.
  if (status >= 300 && status < 400) return true;

  if (status === 404 || status === 410) return false;

  if (status >= 200 && status < 300) {
    const type = (response.headers.get("content-type") ?? "").toLowerCase();
    if (type.includes("text/html") || type.includes("xhtml")) return true;
    // A 200 that is plainly not a page. An API root that lists its own
    // endpoints is the usual shape, and it is still not somewhere to send
    // a person.
    if (type !== "") return false;
    // No content type at all says nothing either way.
    return null;
  }

  // 401 and 403 are the app's own authentication, which a website has just as
  // much as an API does. 405 means something is routed there but not for GET.
  // 5xx is a bad moment, not a design. None of them are evidence.
  return null;
}
