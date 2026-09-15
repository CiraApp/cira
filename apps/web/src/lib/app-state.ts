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
  /** Deployed and running, but Cira holds no key, so it cannot let anyone in. */
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
   * Whether Cira holds the key to this app.
   *
   * Required rather than optional: the page offering an Open button and the
   * route refusing to act on it is the same bug twice, and a default would let
   * a caller forget which of the two it is.
   */
  ciraHoldsKey: boolean,
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

  // Running, but Cira cannot open it. Saying "Live" and offering a button that
  // bounces the person back here is worse than admitting it.
  if (!ciraHoldsKey) {
    return {
      state: "unreachable",
      openUrl: null,
      label: "Not reachable",
      blockedReason:
        "This app is running, but Cira cannot open it yet. Deploy it again with cira deploy to reconnect it.",
    };
  }

  return { state: "live", openUrl: url, label: "Live", blockedReason: null };
}
