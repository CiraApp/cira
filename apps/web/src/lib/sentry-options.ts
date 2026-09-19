import type { Event } from "@sentry/nextjs";

/**
 * How Cira reports its own errors to Sentry, the same in the browser, on the
 * server and at the edge.
 *
 * Cira is a conduit, not a vault (docs/secrets.md): environment values pass
 * through it on the way to Google, and company data passes through it on the
 * way to people. None of that may end up in an error report. So nothing about
 * a person is sent by default, a request's body, cookies and query are dropped
 * before an event leaves, and of its headers only the browser's name is kept.
 * Local variables are never captured - the SDK's default on the server, left
 * that way deliberately, since a deploy holds an app's secrets in one.
 *
 * Only a build with a DSN reports anything, and only production is given
 * one, so development and previews stay quiet.
 */

// Written out with dots, because that is the only form Next replaces with
// the value in the browser's bundle.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

export const sentryOptions = {
  dsn,
  enabled: dsn !== undefined && dsn !== "",
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
  sendDefaultPii: false,
  // Enough requests to see where time goes, few enough to stay in the free
  // allowance at a design partner's traffic.
  tracesSampleRate: 0.1,
  beforeSend: scrub,
  beforeSendTransaction: scrub,
};

/** An event with nothing a request carried but where it went. */
export function scrub<E extends Event>(event: E): E {
  const request = event.request;
  if (request !== undefined) {
    delete request.data;
    delete request.cookies;
    delete request.query_string;
    if (request.url !== undefined) request.url = request.url.split("?")[0] ?? request.url;
    const agent = headerValue(request.headers, "user-agent");
    request.headers = agent === undefined ? {} : { "user-agent": agent };
  }
  return event;
}

function headerValue(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (headers === undefined) return undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key === undefined ? undefined : headers[key];
}
