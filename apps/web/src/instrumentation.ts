import * as Sentry from "@sentry/nextjs";

/**
 * Starts Cira's error reporting when a server starts, in whichever runtime it
 * is. The options are the same everywhere; see lib/sentry-options.ts.
 */
export async function register() {
  const { sentryOptions } = await import("@/lib/sentry-options");
  if (
    process.env["NEXT_RUNTIME"] === "nodejs" ||
    process.env["NEXT_RUNTIME"] === "edge"
  ) {
    Sentry.init(sentryOptions);
  }
}

/** Errors thrown while rendering or handling a request, which Next reports here. */
export const onRequestError = Sentry.captureRequestError;
