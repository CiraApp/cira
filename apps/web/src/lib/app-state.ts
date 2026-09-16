import type { App, Deployment } from "@cira/core";

/**
 * One coherent answer to "what is going on with this app?".
 *
 * An app row carries a status and a deployment row carries another, and they
 * can disagree: an app marked live with no deployment behind it is not live,
 * it has never shipped. Deriving every part of the screen from this single
 * value is what stops a page claiming "Live" above "not deployed".
 */
export type AppState =
  | "live"
  | "deploying"
  | "failed"
  | "never-deployed"
  /** Running, but there is no way for a browser to get in. */
  | "unreachable";

export interface ResolvedApp {
  state: AppState;
  /** Present only when the app can actually be opened. */
  openUrl: string | null;
  label: string;
  /** Plain-language explanation shown when the app cannot be opened. */
  blockedReason: string | null;
}

export function resolveAppState(
  app: App,
  deployment: Deployment | null,
  /**
   * Where a browser should be sent, or null when nowhere can be.
   *
   * Computed by the caller rather than here, because it depends on which
   * domain apps are served under - configuration, which this function has no
   * business reading. Null covers both an unconfigured deployment and an app
   * whose slugs are too long to make a legal hostname.
   */
  openAt: string | null,
): ResolvedApp {
  const url = deployment?.url ?? null;

  if (deployment === null) {
    return {
      state: "never-deployed",
      openUrl: null,
      label: "Never deployed",
      blockedReason: "Nobody has deployed this app yet.",
    };
  }

  if (app.status === "failed" || deployment.status === "failed") {
    return {
      state: "failed",
      openUrl: null,
      label: "Failed",
      blockedReason: "The last deploy of this app did not finish.",
    };
  }

  if (
    app.status === "deploying" ||
    deployment.status === "building" ||
    deployment.status === "deploying" ||
    deployment.status === "queued"
  ) {
    return {
      state: "deploying",
      openUrl: null,
      label: "Deploying",
      blockedReason: "This app is deploying now. It will open once that finishes.",
    };
  }

  if (deployment.status === "removed") {
    return {
      state: "never-deployed",
      openUrl: null,
      label: "Removed",
      blockedReason: "This app's deployment has been removed.",
    };
  }

  // Live status with nothing to open is not live, whatever the row says.
  if (url === null) {
    return {
      state: "never-deployed",
      openUrl: null,
      label: "Never deployed",
      blockedReason: "This app has no address yet.",
    };
  }

  // Running, and reachable by an assistant, but with no address a browser can
  // be sent to. Offering an Open button that goes nowhere is worse than saying
  // so.
  if (openAt === null) {
    return {
      state: "unreachable",
      openUrl: null,
      label: "Running",
      blockedReason:
        "This app is running and assistants can use it, but it has no web address yet.",
    };
  }

  return { state: "live", openUrl: openAt, label: "Live", blockedReason: null };
}
