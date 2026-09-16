import { describe, expect, it } from "vitest";
import { resolveAppState } from "./app-state";
import type { App, Deployment } from "@cira/core";

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
    provider: "vercel",
    providerDeploymentId: "dpl_1",
    status,
    url,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

describe("resolveAppState", () => {
  // A running app is running, and an assistant can use it. What it is not is
  // openable in a browser, because Cloud Run wants a header on every request
  // and a navigation cannot carry one. Saying so is the whole point: the
  // message this replaced told people to redeploy, which could never help.
  it("says a running app is running, without offering a door", () => {
    const r = resolveAppState(app("live"), deployment("live"));
    expect(r.state).toBe("unreachable");
    expect(r.label).toBe("Running");
    expect(r.openUrl).toBeNull();
    expect(r.blockedReason).toContain("not available yet");
    expect(r.blockedReason).not.toContain("cira deploy");
  });

  // The ordering that matters: a deploy still in flight, or one that failed,
  // is reported as such rather than being flattened into "running".
  it("does not let the missing door hide what is actually happening", () => {
    expect(resolveAppState(app("deploying"), deployment("building")).state).toBe(
      "deploying",
    );
    expect(resolveAppState(app("failed"), deployment("failed")).state).toBe("failed");
    expect(resolveAppState(app("live"), null).state).toBe("never-deployed");
  });

  it("does not claim live when the app has never deployed", () => {
    const r = resolveAppState(app("live"), null);
    expect(r.state).toBe("never-deployed");
    expect(r.openUrl).toBeNull();
    expect(r.label).not.toBe("Live");
  });

  it("does not claim live when the deployment has no address", () => {
    const r = resolveAppState(app("live"), deployment("live", null));
    expect(r.state).toBe("never-deployed");
    expect(r.openUrl).toBeNull();
  });

  it("reports failure from either record", () => {
    expect(resolveAppState(app("failed"), deployment("live")).state).toBe("failed");
    expect(resolveAppState(app("live"), deployment("failed")).state).toBe("failed");
  });

  it("reports in-progress deploys from either record", () => {
    expect(resolveAppState(app("deploying"), deployment("live")).state).toBe("deploying");
    expect(resolveAppState(app("live"), deployment("building")).state).toBe("deploying");
    expect(resolveAppState(app("live"), deployment("queued")).state).toBe("deploying");
  });

  it("never offers a link without also clearing the reason, and vice versa", () => {
    const cases: Array<[App["status"], Deployment | null]> = [
      ["live", deployment("live")],
      ["live", null],
      ["failed", deployment("failed")],
      ["deploying", deployment("building")],
      ["draft", deployment("removed")],
      ["live", deployment("live", null)],
    ];
    for (const [status, dep] of cases) {
      const r = resolveAppState(app(status), dep);
      expect(r.openUrl === null).toBe(r.blockedReason !== null);
    }
  });
});

/**
 * The bug this guards against: the app page offered an Open button while the
 * route that had to act on it refused, so clicking did nothing and said
 * nothing. Both now read this one function, so the invariant below is the
 * thing that keeps them agreeing.
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

  it("never offers a link without a reason, or a reason without withholding the link", () => {
    for (const status of statuses) {
      for (const dep of deployments) {
        const r = resolveAppState(app(status), dep);
        expect(r.openUrl === null).toBe(r.blockedReason !== null);
      }
    }
  });

  it("only ever calls an app Live when it can actually be opened", () => {
    for (const status of statuses) {
      for (const dep of deployments) {
        const r = resolveAppState(app(status), dep);
        if (r.label === "Live") expect(r.openUrl).not.toBeNull();
      }
    }
  });
});
