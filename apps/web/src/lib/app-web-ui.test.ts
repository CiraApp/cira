import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, Deployment } from "@cira/core";

/**
 * When Cira decides to go and ask an app whether it has a front door.
 *
 * The decision matters more than the asking, which is tested next door. Asking
 * costs a request and a Google token on a page somebody is waiting for, so it
 * has to happen exactly once per app and never when there is nothing running
 * to answer.
 */

const updated: Array<Record<string, unknown>> = [];
let tokenFails = false;

vi.mock("@cira/db", () => ({
  apps: { id: "apps.id" },
  db: () => ({
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          updated.push(values);
          return Promise.resolve();
        },
      }),
    }),
  }),
}));

vi.mock("drizzle-orm", () => ({ eq: () => "eq" }));

vi.mock("@cira/deploy", () => ({
  deploymentProvider: () => ({
    invocationToken: () =>
      tokenFails ? Promise.reject(new Error("no google")) : Promise.resolve("tok"),
  }),
}));

const probed: string[] = [];
let answer: boolean | null = false;

vi.mock("@/lib/browser-ui", () => ({
  probeWebUi: (args: { origin: string }) => {
    probed.push(args.origin);
    return Promise.resolve(answer);
  },
}));

const app = (hasWebUi: boolean | null): App => ({
  id: "app_1",
  spaceId: "spc_1",
  name: "Wave API",
  slug: "wave-api",
  description: null,
  status: "live",
  icon: null,
  ownerUserId: "usr_1",
  homepageUrl: null,
  hasWebUi,
  capabilitiesAnalyzedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

const deployment = (
  status: Deployment["status"],
  url: string | null = "https://wave-api.run.app",
): Deployment => ({
  id: "dep_1",
  appId: "app_1",
  provider: "cloudrun",
  providerDeploymentId: "p1",
  status,
  url,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

async function learn(a: App, d: Deployment | null) {
  const { learnWebUi } = await import("./app-web-ui");
  return learnWebUi(a, d);
}

describe("learnWebUi", () => {
  beforeEach(() => {
    updated.length = 0;
    probed.length = 0;
    tokenFails = false;
    answer = false;
  });

  it("asks an app that has never been asked, and remembers", async () => {
    const result = await learn(app(null), deployment("live"));

    expect(probed).toEqual(["https://wave-api.run.app"]);
    expect(updated[0]?.["hasWebUi"]).toBe(false);
    expect(result.hasWebUi).toBe(false);
  });

  it("never asks twice", async () => {
    // The expensive mistake: a request to the app on every page view forever.
    for (const known of [true, false]) {
      await learn(app(known), deployment("live"));
    }
    expect(probed).toEqual([]);
    expect(updated).toEqual([]);
  });

  it("does not ask when there is nothing running to answer", async () => {
    for (const d of [null, deployment("building"), deployment("failed")]) {
      await learn(app(null), d);
    }
    expect(probed).toEqual([]);
  });

  it("does not ask an app with no address", async () => {
    await learn(app(null), deployment("live", null));
    expect(probed).toEqual([]);
  });

  it("writes nothing down when the app did not answer clearly", async () => {
    // Null means unsettled, so it must stay unsettled and be asked again.
    answer = null;
    const result = await learn(app(null), deployment("live"));

    expect(probed).toHaveLength(1);
    expect(updated).toEqual([]);
    expect(result.hasWebUi).toBeNull();
  });

  it("gives up quietly when no token can be had", async () => {
    // Google being unreachable is not news about the app, and is certainly not
    // a reason for its page to fail to render.
    tokenFails = true;
    const result = await learn(app(null), deployment("live"));

    expect(probed).toEqual([]);
    expect(result.hasWebUi).toBeNull();
  });
});
