import { describe, expect, it } from "vitest";
import { serviceForPath, type Service } from "./model.js";

/**
 * Which half of an app answers a request.
 *
 * This is the rule that lets a frontend and the API behind it share one
 * address, so getting it wrong does not produce an error - it produces an app
 * where some pages work and some do not, which is far harder to notice.
 */
const service = (slug: string, routes: string[]): Service => ({
  id: `svc_${slug}`,
  appId: "app_1",
  slug,
  sourcePath: `apps/${slug}`,
  dockerfile: null,
  port: null,
  routes,
  hasWebUi: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

const web = service("web", []);
const api = service("api", ["/api/v1", "/share"]);

describe("serviceForPath", () => {
  it("sends a claimed path to the service that claimed it", () => {
    expect(serviceForPath([web, api], "/api/v1/tracks")?.slug).toBe("api");
    expect(serviceForPath([web, api], "/share/abc")?.slug).toBe("api");
  });

  it("matches the prefix itself, not only paths beneath it", () => {
    expect(serviceForPath([web, api], "/api/v1")?.slug).toBe("api");
  });

  it("gives everything else to the front door", () => {
    // Null means "nobody claimed it", which is how the front door is chosen:
    // by not having to claim anything.
    for (const path of ["/", "/home", "/p/dana", "/_next/static/x.js"]) {
      expect(serviceForPath([web, api], path), path).toBeNull();
    }
  });

  /** `/api` must not swallow `/apiary`, which is a different page entirely. */
  it("never matches half a path segment", () => {
    expect(serviceForPath([web, api], "/api/v1x")).toBeNull();
    expect(serviceForPath([web, service("a", ["/api"])], "/apiary")).toBeNull();
  });

  it("prefers the most specific claim", () => {
    const broad = service("broad", ["/api"]);
    const narrow = service("narrow", ["/api/v1/admin"]);
    expect(serviceForPath([broad, narrow], "/api/v1/admin/users")?.slug).toBe("narrow");
    expect(serviceForPath([broad, narrow], "/api/v1/tracks")?.slug).toBe("broad");
  });

  it("ignores a claim that claims everything", () => {
    // A bare "/" would capture the whole app and leave the front door
    // unreachable, so it is not a usable claim.
    expect(serviceForPath([service("greedy", ["/"])], "/home")).toBeNull();
  });

  it("has nothing to say about an app with one service", () => {
    expect(serviceForPath([service("app", [])], "/anything")).toBeNull();
  });
});
