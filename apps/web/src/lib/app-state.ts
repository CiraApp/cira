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
  | "unreachable"
  /** Running and working, but it is not a website and never was. */
  | "no-ui";

export interface ResolvedApp {
  state: AppState;
  /** Present only when the app can actually be opened. */
  openUrl: string | null;
  /**
   * True when `openUrl` leaves Cira, so the link is followed directly rather
   * than through the door on Cira's own domain. Only an app carrying its own
   * homepage is external; everything Cira serves goes through `/enter`.
   */
  external: boolean;
  label: string;
  /** Plain-language explanation shown when the app cannot be opened. */
  blockedReason: string | null;
  /** Set for an app that is only workers and scheduled runs. */
  background?: true;
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
  const deployed = fromDeployment(app, deployment, openAt);

  // An app that says where it really lives can always be opened, whatever its
  // deployment is doing - they are answers to different questions. Wave's site
  // is up while the API behind it is halfway through a build, and a shelf that
  // refused to open it in that minute would be wrong about the thing a person
  // actually clicks. The status still reports the deploy, honestly; it just no
  // longer decides whether there is a door.
  if (app.homepageUrl !== null && app.homepageUrl !== "") {
    return {
      ...deployed,
      openUrl: app.homepageUrl,
      external: true,
      blockedReason: null,
    };
  }

  return deployed;
}

function fromDeployment(
  app: App,
  deployment: Deployment | null,
  openAt: string | null,
): ResolvedApp {
  const url = deployment?.url ?? null;

  if (deployment === null) {
    return {
      state: "never-deployed",
      openUrl: null,
      external: false,
      label: "Never deployed",
      blockedReason: "Nobody has deployed this app yet.",
    };
  }

  if (app.status === "failed" || deployment.status === "failed") {
    return {
      state: "failed",
      openUrl: null,
      external: false,
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
      external: false,
      label: "Deploying",
      blockedReason: "This app is deploying now. It will open once that finishes.",
    };
  }

  if (deployment.status === "removed") {
    return {
      state: "never-deployed",
      openUrl: null,
      external: false,
      label: "Removed",
      blockedReason: "This app's deployment has been removed.",
    };
  }

  // An app that is only workers and scheduled runs: live, doing its work in
  // the background, with nothing to open - and none of that is a problem.
  if (!deployment.servesWeb) {
    return {
      state: "no-ui",
      openUrl: null,
      external: false,
      label: "Live",
      blockedReason:
        "This app has no web interface. It runs in the background: its workers and scheduled runs are below.",
      background: true,
    };
  }

  // Live status with nothing to open is not live, whatever the row says.
  if (url === null) {
    return {
      state: "never-deployed",
      openUrl: null,
      external: false,
      label: "Never deployed",
      blockedReason: "This app has no address yet.",
    };
  }

  // Not a website, and it never was. An API is doing its whole job when it
  // answers assistants, so this is "Live" and not a degraded state - but there
  // is nothing to open, and an Open button leading to its 404 would be Cira
  // inventing a front door the app does not have.
  //
  // Checked before the address below because it is the truer reason of the
  // two: telling someone an API "has no web address yet" invites them to go
  // and configure one.
  if (app.hasWebUi === false) {
    return {
      state: "no-ui",
      openUrl: null,
      external: false,
      label: "Live",
      blockedReason:
        "This app has no web interface. It is running, and assistants can use its capabilities.",
    };
  }

  // Running, and reachable by an assistant, but with no address a browser can
  // be sent to. Offering an Open button that goes nowhere is worse than saying
  // so.
  if (openAt === null) {
    return {
      state: "unreachable",
      openUrl: null,
      external: false,
      label: "Running",
      blockedReason:
        "This app is running and assistants can use it, but it has no web address yet.",
    };
  }

  return {
    state: "live",
    openUrl: openAt,
    external: false,
    label: "Live",
    blockedReason: null,
  };
}

/**
 * Where an app's Open button goes, and what is said instead when it has none.
 *
 * An app with no web page opens into its console. It is running and working,
 * and a person who may open it should be able to use it without an agent in
 * between; a page that only explained why there was no button left API-only
 * apps invisible to everyone but assistants.
 *
 * Unless there is nothing in it to run. A service that answers "hello world"
 * is running, but it is not software anyone can use, and a button that opens
 * an empty console is a door into a cupboard. Then there is no button, and the
 * sentence says so rather than promising capabilities that are not there.
 *
 * An app Cira serves is opened through `/open`, which checks access again and
 * hands over to the door on Cira's own domain. One that carries its own
 * address is simply linked to: Cira does not serve it, cannot vouch for it,
 * and has no relationship with that host to hand a referrer to.
 */
export function appDoor(
  resolved: ResolvedApp,
  address: { spaceSlug: string; appSlug: string },
  /** How many capabilities the app has, whatever state they are in. */
  capabilities: number,
): { href: string | null; blockedReason: string | null } {
  const page = `/${address.spaceSlug}/${address.appSlug}`;
  if (resolved.openUrl !== null) {
    return {
      href: resolved.external ? resolved.openUrl : `${page}/open`,
      blockedReason: null,
    };
  }
  if (resolved.state === "no-ui") {
    if (capabilities > 0) return { href: consoleHref(address), blockedReason: null };
    // One that runs in the background already says where its work is; any
    // other no-web app with nothing to run is told so plainly.
    return {
      href: null,
      blockedReason:
        resolved.background === true
          ? resolved.blockedReason
          : "This app has no web interface, and nothing in it can be run from Cira yet.",
    };
  }
  return { href: null, blockedReason: resolved.blockedReason };
}

/** An app's capability console. */
export function consoleHref(address: { spaceSlug: string; appSlug: string }): string {
  return `/${address.spaceSlug}/${address.appSlug}/console`;
}
