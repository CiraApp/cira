import { clerkMiddleware } from "@clerk/nextjs/server";

/**
 * Establishes the session for every request, and nothing more.
 *
 * Access is NOT enforced here. Path-matching middleware can diverge from how
 * Next actually routes a request, which leaves protected pages reachable when
 * the two disagree. Cira enforces access where the data is read instead: every
 * read goes through `lib/authz.ts`, so a route cannot ship unprotected by
 * forgetting to add it to a list.
 */
export default clerkMiddleware();

export const config = {
  matcher: [
    // Not /monitoring: that is Sentry's relay for the browser's error
    // reports, which needs no session and should cost none.
    "/((?!_next|monitoring|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
