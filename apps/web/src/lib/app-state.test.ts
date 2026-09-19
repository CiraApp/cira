import { describe, expect, it } from "vitest";
import { appDoor, resolveAppState } from "./app-state";
import type { App, Deployment } from "@cira/core";

/** Where a browser is sent when there is somewhere to send it. */
const OPEN_AT = "/enter/revenue--acme";

function app(
  status: App["status"],
  extra: Partial<Pick<App, "homepageUrl" | "hasWebUi">> = {},
): App {
  return {
    id: "app_1",
    spaceId: "spc_1",
    name: "Revenue",
    slug: "revenue",
    description: null,
    status,
    icon: null,
    image: null,
    ownerUserId: "usr_1",
    homepageUrl: null,
    hasWebUi: null,
    capabilitiesAnalyzedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...extra,
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
    servesWeb: true,
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
  const homepages = [null, "https://wav3.space/"];
  const webUi = [null, true, false];

  /** Every shape an app can be in, which is what these invariants sweep. */
  function every(check: (resolved: ReturnType<typeof resolveAppState>) => void) {
    for (const status of statuses) {
      for (const dep of deployments) {
        for (const at of addresses) {
          for (const homepageUrl of homepages) {
            for (const hasWebUi of webUi) {
              check(resolveAppState(app(status, { homepageUrl, hasWebUi }), dep, at));
            }
          }
        }
      }
    }
  }

  it("never offers a link without a reason, or a reason without withholding the link", () => {
    every((r) => {
      expect(r.openUrl === null).toBe(r.blockedReason !== null);
    });
  });

  /**
   * This used to say that "Live" implied the app could be opened, and openness
   * was a fine stand-in for working while every app was a website. It stopped
   * being one: an API is doing its entire job when it answers assistants and
   * has nothing a browser would want. So the rule is the one openability was
   * standing in for all along - Live means the thing is actually serving.
   */
  it("only ever calls an app Live when it is really running", () => {
    every((r) => {
      if (r.label === "Live") {
        expect(["live", "no-ui"]).toContain(r.state);
      }
    });
  });

  it("never offers a link when there is no address of any kind", () => {
    for (const status of statuses) {
      for (const dep of deployments) {
        for (const hasWebUi of webUi) {
          const r = resolveAppState(app(status, { hasWebUi }), dep, null);
          expect(r.openUrl).toBeNull();
        }
      }
    }
  });

  /** Whatever else is true, an address Cira was given is one it will use. */
  it("always has somewhere to go when the app carries its own address", () => {
    for (const status of statuses) {
      for (const dep of deployments) {
        for (const at of addresses) {
          const r = resolveAppState(
            app(status, { homepageUrl: "https://wav3.space/" }),
            dep,
            at,
          );
          expect(r.openUrl).toBe("https://wav3.space/");
          expect(r.external).toBe(true);
        }
      }
    }
  });
});

describe("an app with no web interface", () => {
  it("is live, and offers no door", () => {
    const resolved = resolveAppState(
      app("live", { hasWebUi: false }),
      deployment("live"),
      OPEN_AT,
    );

    // Running and answering assistants is the whole job for an API. It is not
    // a degraded state, so the label must not suggest something is wrong.
    expect(resolved.label).toBe("Live");
    expect(resolved.state).toBe("no-ui");
    expect(resolved.openUrl).toBeNull();
    expect(resolved.blockedReason).toContain("no web interface");
  });

  it("says so rather than blaming the address", () => {
    // Both are true of an unconfigured API. Telling someone it "has no web
    // address yet" sends them off to configure one that would still 404.
    const resolved = resolveAppState(
      app("live", { hasWebUi: false }),
      deployment("live"),
      null,
    );
    expect(resolved.state).toBe("no-ui");
  });

  it("is still shown as deploying while it deploys", () => {
    const resolved = resolveAppState(
      app("deploying", { hasWebUi: false }),
      deployment("building"),
      OPEN_AT,
    );
    expect(resolved.state).toBe("deploying");
  });

  it("opens normally until something has actually asked", () => {
    // Null is "not yet asked", and guessing headless would hide a working app.
    const resolved = resolveAppState(
      app("live", { hasWebUi: null }),
      deployment("live"),
      OPEN_AT,
    );
    expect(resolved.openUrl).toBe(OPEN_AT);
  });
});

describe("an app that says where it really lives", () => {
  const HOMEPAGE = "https://wav3.space/";

  it("opens there instead of at the app Cira serves", () => {
    const resolved = resolveAppState(
      app("live", { homepageUrl: HOMEPAGE }),
      deployment("live"),
      OPEN_AT,
    );
    expect(resolved.openUrl).toBe(HOMEPAGE);
    expect(resolved.external).toBe(true);
  });

  /**
   * The two are answers to different questions. A site stays up while the API
   * behind it is halfway through a build, and refusing to open it in that
   * minute would be wrong about the thing a person is actually clicking.
   */
  it("opens even while the deployment behind it is not ready", () => {
    for (const status of ["building", "failed", "removed"] as const) {
      const resolved = resolveAppState(
        app("live", { homepageUrl: HOMEPAGE }),
        deployment(status),
        OPEN_AT,
      );
      expect(resolved.openUrl, status).toBe(HOMEPAGE);
      expect(resolved.blockedReason, status).toBeNull();
    }
  });

  it("opens an API that has no page of its own", () => {
    // The case the field exists for: the half deployed here serves JSON, and
    // the half people use is somewhere else.
    const resolved = resolveAppState(
      app("live", { homepageUrl: HOMEPAGE, hasWebUi: false }),
      deployment("live"),
      OPEN_AT,
    );
    expect(resolved.openUrl).toBe(HOMEPAGE);
  });

  it("still reports the deploy honestly", () => {
    // Having somewhere to go does not make a failed build a success.
    const resolved = resolveAppState(
      app("live", { homepageUrl: HOMEPAGE }),
      deployment("failed"),
      OPEN_AT,
    );
    expect(resolved.state).toBe("failed");
    expect(resolved.label).toBe("Failed");
  });

  it("goes through Cira's own door when it has none", () => {
    const resolved = resolveAppState(app("live"), deployment("live"), OPEN_AT);
    expect(resolved.external).toBe(false);
    expect(resolved.openUrl).toBe(OPEN_AT);
  });
});

describe("appDoor", () => {
  const address = { spaceSlug: "acme", appSlug: "revenue" };
  const noUi = () =>
    resolveAppState(app("live", { hasWebUi: false }), deployment("live"), OPEN_AT);

  it("opens an app with no web page into its console", () => {
    const resolved = noUi();
    expect(resolved.state).toBe("no-ui");
    expect(appDoor(resolved, address, 3)).toEqual({
      href: "/acme/revenue/console",
      blockedReason: null,
    });
  });

  /**
   * A hello-world service: running, and nothing anyone could use. A button
   * into an empty console would be a door into a cupboard, and the usual
   * sentence would promise capabilities that are not there.
   */
  it("offers no door into an empty console, and does not promise capabilities", () => {
    const door = appDoor(noUi(), address, 0);
    expect(door.href).toBeNull();
    expect(door.blockedReason).toContain("nothing in it can be run");
    expect(door.blockedReason).not.toContain("assistants can use");
  });

  it("opens a website through Cira's door, and a homepage directly", () => {
    const site = resolveAppState(
      app("live", { hasWebUi: true }),
      deployment("live"),
      OPEN_AT,
    );
    expect(appDoor(site, address, 0).href).toBe("/acme/revenue/open");

    // An API that says where its front end lives goes there, not to the console.
    const elsewhere = resolveAppState(
      app("live", { hasWebUi: false, homepageUrl: "https://revenue.acme.com" }),
      deployment("live"),
      OPEN_AT,
    );
    expect(appDoor(elsewhere, address, 5).href).toBe("https://revenue.acme.com");
  });

  it("offers no door while an app cannot be used at all, and says why", () => {
    for (const resolved of [
      resolveAppState(app("deploying"), deployment("building"), OPEN_AT),
      resolveAppState(app("failed"), deployment("failed"), OPEN_AT),
      resolveAppState(app("live"), null, OPEN_AT),
      resolveAppState(app("live", { hasWebUi: true }), deployment("live"), null),
    ]) {
      const door = appDoor(resolved, address, 4);
      expect(door.href).toBeNull();
      expect(door.blockedReason).toBe(resolved.blockedReason);
    }
  });
});
