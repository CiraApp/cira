import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry-options";

/**
 * Error reporting in the browser. No session replay: it records people's
 * screens, and Cira's screens show companies' data.
 */
Sentry.init(sentryOptions);

/** Names each navigation, so a slow page shows up as the page it is. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
