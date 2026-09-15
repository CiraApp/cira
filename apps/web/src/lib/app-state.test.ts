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
  it("opens only when there is something to open", () => {
    const r = resolveAppState(app("live"), deployment("live"), true);
    expect(r.state).toBe("live");
    expect(r.openUrl).toBe("https://x.example");
    expect(r.blockedReason).toBeNull();
  });

  it("does not claim live when the app has never deployed", () => {
    const r = resolveAppState(app("live"), null, true);
    expect(r.state).toBe("never-deployed");
    expect(r.openUrl).toBeNull();
    expect(r.label).not.toBe("Live");
  });

  it("does not claim live when the deployment has no address", () => {
    const r = resolveAppState(app("live"), deployment("live", null), true);
    expect(r.state).toBe("never-deployed");
    expect(r.openUrl).toBeNull();
  });

  it("reports failure from either record", () => {
    expect(resolveAppState(app("failed"), deployment("live"), true).state).toBe("failed");
    expect(resolveAppState(app("live"), deployment("failed"), true).state).toBe("failed");
  });

  it("reports in-progress deploys from either record", () => {
    expect(resolveAppState(app("deploying"), deployment("live"), true).state).toBe(
      "deploying",
    );
    expect(resolveAppState(app("live"), deployment("building"), true).state).toBe(
      "deploying",
    );
    expect(resolveAppState(app("live"), deployment("queued"), true).state).toBe(
      "deploying",
    );
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
      const r = resolveAppState(app(status), dep, true);
      expect(r.openUrl === null).toBe(r.blockedReason !== null);
    }
  });
});

describe("when Cira holds no key", () => {
  it("refuses to call a running app openable", () => {
    const r = resolveAppState(app("live"), deployment("live"), false);
    expect(r.state).toBe("unreachable");
    expect(r.openUrl).toBeNull();
    expect(r.label).not.toBe("Live");
    expect(r.blockedReason).toContain("cira deploy");
  });

  it("still reports a failure as a failure, not as unreachable", () => {
    expect(resolveAppState(app("failed"), deployment("failed"), false).state).toBe(
      "failed",
    );
  });

  it("still reports an in-progress deploy as deploying", () => {
    expect(resolveAppState(app("deploying"), deployment("building"), false).state).toBe(
      "deploying",
    );
  });

  it("never offers a link without a reason, with or without the key", () => {
    for (const key of [true, false]) {
      for (const dep of [deployment("live"), deployment("failed"), null]) {
        const r = resolveAppState(app("live"), dep, key);
        expect(r.openUrl === null).toBe(r.blockedReason !== null);
      }
    }
  });
});
