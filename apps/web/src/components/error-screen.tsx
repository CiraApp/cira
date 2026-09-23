"use client";

import { useEffect, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import { isStaleBuild, reloadForNewBuild } from "@/lib/stale-build";

/**
 * What a person sees when a page breaks, and the report that goes with it.
 *
 * An error from the server arrives here carrying only a digest, having been
 * reported where it happened (see instrumentation.ts); reporting it again
 * would be the same error twice with less in it. An error thrown in the
 * browser has no digest and has not been reported, so it is reported here.
 * The digest is shown, so whoever looks into it can find it.
 */
export function ErrorScreen({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const stale = isStaleBuild(error);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    // A page from before a deploy is not an error worth anyone's attention.
    // It goes straight to the new version instead, once.
    if (stale) {
      setReloading(reloadForNewBuild());
      return;
    }
    if (error.digest === undefined) Sentry.captureException(error);
  }, [error, stale]);

  if (stale) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-4 py-16">
        <div className="enter-up w-full max-w-[400px]">
          <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
            Cira was updated
          </h1>
          <p role="status" className="mt-2 text-[13px] leading-relaxed text-ink-muted">
            {reloading
              ? "A new version went live while this page was open. Loading it now."
              : "A new version went live while this page was open. Reload to carry on; what you last pressed did not happen."}
          </p>
          {reloading ? null : (
            <div className="mt-5">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="btn btn-primary px-3 py-1.5 text-[12.5px]"
              >
                Reload
              </button>
            </div>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-16">
      <div className="enter-up w-full max-w-[400px]">
        <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
          Something went wrong
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
          This page could not be shown. Cira has been told about it, so there is nothing
          you need to report. Trying again usually works.
        </p>
        {error.digest !== undefined ? (
          <p className="mt-3 font-mono text-[11.5px] text-ink-subtle">
            Reference {error.digest}
          </p>
        ) : null}
        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => retry()}
            className="btn btn-primary px-3 py-1.5 text-[12.5px]"
          >
            Try again
          </button>
          {/* A plain link, not the router's: the router is what may be broken. */}
          <a href="/" className="btn btn-ghost px-3 py-1.5 text-[12.5px]">
            Go to your apps
          </a>
        </div>
      </div>
    </main>
  );
}
