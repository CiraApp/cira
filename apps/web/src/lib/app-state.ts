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

/**
 * Whether a person can open a deployed app in their browser.
 *
 * False, for now, and the reason is worth writing down. Apps run on Cloud Run,
 * which is private by IAM: it wants an identity token on every request, and a
 * browser cannot put one on a navigation. The previous provider took a secret
 * in the query string and traded it for a cookie, which is what the Open
 * button used to rely on and why nothing like it exists here.
 *
 * Closing this needs a proxy holding the token on the browser's behalf, at a
 * hostname per app. Until that exists, saying so is better than offering a
 * button that goes nowhere - and far better than the message this replaced,
 * which told people to redeploy, which could never have helped.
 *
 * Agents are unaffected: `invoke-capability` sets the header itself.
 */
const BROWSER_ACCESS = false;

export interface ResolvedApp {
  state: AppState;
  /** Present only when the app can actually be opened. */
  openUrl: string | null;
  label: string;
  /** Plain-language explanation shown when the app cannot be opened. */
  blockedReason: string | null;
}

export function resolveAppState(app: App, deployment: Deployment | null): ResolvedApp {
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

  // Running, and reachable by an assistant, but not by a browser. Offering an
  // Open button that bounces the person back here is worse than admitting it.
  if (!BROWSER_ACCESS) {
    return {
      state: "unreachable",
      openUrl: null,
      label: "Running",
      blockedReason:
        "This app is running and assistants can use it. Opening it in a browser is not available yet.",
    };
  }

  return { state: "live", openUrl: url, label: "Live", blockedReason: null };
}
