import { describe, expect, it } from "vitest";
import { resolveAppState } from "./app-state";
import type { App, Deployment } from "@cira/core";

/** Where a browser is sent when there is somewhere to send it. */
const OPEN_AT = "/enter/revenue--acme";

function app(status: App["status"]): App {
  return {
    id: "app_1",
    spaceId: "spc_1",
    name: "Revenue",
    slug: "revenue",
    description: null,
    status,
    icon: null,
    ownerUserId: "usr_1",
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function deployment(
  status: Deployment["status"],
  url: string | null = "https://x.example",
): Deployment {
  return {
    id: "dep_1",
    appId: "app_1",
    provider: "cloudrun",
    providerDeploymentId: "dpl_1",
    status,
    url,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

describe("resolveAppState", () => {
  it("opens a running app at the address it was given", () => {
    const r = resolveAppState(app("live"), deployment("live"), OPEN_AT);
    expect(r.state).toBe("live");
    expect(r.openUrl).toBe(OPEN_AT);
    expect(r.blockedReason).toBeNull();
  });

  /**
   * An app can be running perfectly and still have nowhere for a browser to
   * go - apps are served under a domain that has to be configured, and a pair
   * of long slugs cannot make a legal hostname. Saying that is better than an
   * Open button that goes nowhere.
   */
  it("says a running app is running when it has no address", () => {
    const r = resolveAppState(app("live"), deployment("live"), null);
    expect(r.state).toBe("unreachable");
    expect(r.label).toBe("Running");
    expect(r.openUrl).toBeNull();
    expect(r.blockedReason).toContain("no web address");
  });

  it("does not claim live when the app has never deployed", () => {
    const r = resolveAppState(app("live"), null, OPEN_AT);
    expect(r.state).toBe("never-deployed");
    expect(r.openUrl).toBeNull();
    expect(r.label).not.toBe("Live");
  });

  it("does not claim live when the deployment has no address", () => {
    const r = resolveAppState(app("live"), deployment("live", null), OPEN_AT);
    expect(r.state).toBe("never-deployed");
    expect(r.openUrl).toBeNull();
  });

  it("reports failure from either record", () => {
    expect(resolveAppState(app("failed"), deployment("live"), OPEN_AT).state).toBe(
      "failed",
    );
    expect(resolveAppState(app("live"), deployment("failed"), OPEN_AT).state).toBe(
      "failed",
    );
  });

  it("reports a deploy in flight as deploying, from either record", () => {
    expect(resolveAppState(app("deploying"), deployment("live"), OPEN_AT).state).toBe(
      "deploying",
    );
    expect(resolveAppState(app("live"), deployment("building"), OPEN_AT).state).toBe(
      "deploying",
    );
    expect(resolveAppState(app("live"), deployment("queued"), OPEN_AT).state).toBe(
      "deploying",
    );
  });

  it("reports a removed deployment as removed", () => {
    expect(resolveAppState(app("live"), deployment("removed"), OPEN_AT).state).toBe(
      "never-deployed",
    );
  });
});

/**
 * The bug this guards against: the app page offered an Open button while the
 * route that had to act on it refused, so clicking did nothing and said
 * nothing. Both read this one function, so the invariant below is what keeps
 * them agreeing.
 */
describe("openability is one answer, for every combination of inputs", () => {
  const statuses = ["live", "deploying", "failed", "draft"] as const;
  const deployments = [
    null,
    deployment("live"),
    deployment("live", null),
    deployment("building"),
    deployment("failed"),
    deployment("queued"),
    deployment("removed"),
  ];
  const addresses = [OPEN_AT, null];

  it("never offers a link without a reason, or a reason without withholding the link", () => {
    for (const status of statuses) {
      for (const dep of deployments) {
        for (const at of addresses) {
          const r = resolveAppState(app(status), dep, at);
          expect(r.openUrl === null).toBe(r.blockedReason !== null);
        }
      }
    }
  });

  it("only ever calls an app Live when it can actually be opened", () => {
    for (const status of statuses) {
      for (const dep of deployments) {
        for (const at of addresses) {
          const r = resolveAppState(app(status), dep, at);
          if (r.label === "Live") expect(r.openUrl).not.toBeNull();
        }
      }
    }
  });

  // Without an address there is nothing to offer, whatever else is true.
  it("never offers a link when there is no address", () => {
    for (const status of statuses) {
      for (const dep of deployments) {
        expect(resolveAppState(app(status), dep, null).openUrl).toBeNull();
      }
    }
  });
});
