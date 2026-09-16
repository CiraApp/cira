import { describe, expect, it } from "vitest";
import { verifyCapabilities, type ProbeTarget } from "./capability-verify";

/** A stand-in app: `routes` is what it serves, everything else is 404. */
function app(routes: Record<string, string[]>) {
  const seen: Array<{ method: string; path: string }> = [];

  const fetcher = async (url: string, init: RequestInit): Promise<Response> => {
    const { pathname, search } = new URL(url);
    const method = (init.method ?? "GET").toUpperCase();
    seen.push({ method, path: pathname + search });

    const methods = routes[pathname];
    if (methods === undefined) return new Response(null, { status: 404 });

    if (method === "OPTIONS") {
      return new Response(null, { status: 405, headers: { allow: methods.join(", ") } });
    }
    if (!methods.includes(method)) return new Response(null, { status: 405 });
    return new Response("{}", { status: 200 });
  };

  return { fetcher, seen };
}

const read = (
  name: string,
  path: string,
  probe?: Record<string, unknown>,
): ProbeTarget => ({
  name,
  method: "GET",
  path,
  risk: "read",
  probe,
});
const write = (name: string, method: string, path: string): ProbeTarget => ({
  name,
  method,
  path,
  risk: "write",
});

const base = { origin: "https://app.test", token: "id-token" };

describe("verifyCapabilities", () => {
  it("keeps what the app serves and drops what it does not", async () => {
    const { fetcher } = app({ "/api/v1/orders": ["GET"] });

    const result = await verifyCapabilities({
      ...base,
      fetcher,
      capabilities: [
        read("listOrders", "/api/v1/orders"),
        read("listGhosts", "/api/v1/ghosts"),
      ],
    });

    expect(result.verified).toEqual(["listOrders"]);
    expect(result.rejected).toEqual(["listGhosts"]);
    expect(result.inconclusive).toBe(false);
  });

  /**
   * The rule that keeps this safe. A write is never called; the app is asked
   * which methods the path allows, which cannot change anything.
   */
  it("never sends a write's own method", async () => {
    const { fetcher, seen } = app({ "/api/v1/orders/{id}": ["DELETE"] });

    await verifyCapabilities({
      ...base,
      fetcher,
      capabilities: [write("deleteOrder", "DELETE", "/api/v1/orders/{id}")],
    });

    expect(seen.map((s) => s.method)).not.toContain("DELETE");
    expect(seen.some((s) => s.method === "OPTIONS")).toBe(true);
  });

  it("reads the methods off Allow rather than guessing", async () => {
    const { fetcher } = app({ "/api/v1/orders": ["GET", "POST"] });

    const result = await verifyCapabilities({
      ...base,
      fetcher,
      capabilities: [
        write("createOrder", "POST", "/api/v1/orders"),
        write("replaceOrder", "PUT", "/api/v1/orders"),
      ],
    });

    expect(result.verified).toEqual(["createOrder"]);
    expect(result.rejected).toEqual(["replaceOrder"]);
  });

  /**
   * Without this, an app with a catch-all would confirm every invention. The
   * control is a path nobody could have written; if it answers, no probe on
   * this app distinguishes anything.
   */
  it("verifies nothing against an app that answers everything", async () => {
    const fetcher = async (): Promise<Response> => new Response("ok", { status: 200 });

    const result = await verifyCapabilities({
      ...base,
      fetcher,
      capabilities: [read("listOrders", "/api/v1/orders")],
    });

    expect(result).toEqual({ verified: [], rejected: [], inconclusive: true });
  });

  it("puts a harmless value where a path parameter goes", async () => {
    const { fetcher, seen } = app({ "/api/v1/orders/cira-probe": ["GET"] });

    const result = await verifyCapabilities({
      ...base,
      fetcher,
      capabilities: [read("getOrder", "/api/v1/orders/{order_id}")],
    });

    expect(result.verified).toEqual(["getOrder"]);
    expect(seen.some((s) => s.path.includes("cira-probe"))).toBe(true);
  });

  it("uses the example input the analyzer supplied", async () => {
    const { fetcher, seen } = app({ "/api/v1/orders/ord_x": ["GET"] });

    await verifyCapabilities({
      ...base,
      fetcher,
      capabilities: [
        read("getOrder", "/api/v1/orders/{order_id}", { order_id: "ord_x", limit: 5 }),
      ],
    });

    const hit = seen.find((s) => s.path.startsWith("/api/v1/orders/ord_x"));
    expect(hit?.path).toContain("limit=5");
  });

  /**
   * An app that routed the request has the route, whatever it then did with
   * it. Deleting a capability because the handler threw, or because the app
   * has its own login, would be wrong.
   */
  it("counts a route that exists but refuses", async () => {
    const fetcher = async (url: string): Promise<Response> =>
      new URL(url).pathname === "/api/v1/orders"
        ? new Response(null, { status: 401 })
        : new Response(null, { status: 404 });

    const result = await verifyCapabilities({
      ...base,
      fetcher,
      capabilities: [read("listOrders", "/api/v1/orders")],
    });

    expect(result.verified).toEqual(["listOrders"]);
  });

  // Briefly unreachable is not the same as absent, and treating it as absent
  // would delete an app's capabilities because it was slow for a moment.
  it("does not reject a read it could not reach", async () => {
    const fetcher = async (): Promise<Response> => {
      throw new Error("network");
    };

    const result = await verifyCapabilities({
      ...base,
      fetcher,
      capabilities: [read("listOrders", "/api/v1/orders")],
    });

    expect(result.inconclusive).toBe(true);
  });

  it("does nothing when there is nothing to check", async () => {
    const { fetcher, seen } = app({});
    const result = await verifyCapabilities({ ...base, fetcher, capabilities: [] });
    expect(result).toEqual({ verified: [], rejected: [], inconclusive: false });
    expect(seen).toHaveLength(0);
  });
});

/**
 * The check that matters most here, and the reason it is repeated rather than
 * trusted from further up: this is the last point before a request that
 * carries the app's own credential, and `new URL(path, origin)` discards the
 * origin when the path is absolute.
 */
describe("a path can never leave the app it belongs to", () => {
  it("refuses to probe anywhere but the app's own origin", async () => {
    const reached: string[] = [];

    // 404s the negative control so verification proceeds, and would answer
    // anything else - so a capability that survives has genuinely been probed.
    const fetcher = async (url: string): Promise<Response> => {
      const target = new URL(url);
      reached.push(target.origin);
      if (target.pathname.startsWith("/__cira-probe-")) {
        return new Response(null, { status: 404 });
      }
      return new Response("{}", { status: 200, headers: { allow: "GET, POST" } });
    };

    const result = await verifyCapabilities({
      ...base,
      fetcher,
      capabilities: [
        read("honest", "/api/v1/orders"),
        read("stealer", "https://evil.test/steal"),
        read("schemeless", "//evil.test/steal"),
        write("poster", "POST", "https://evil.test/steal"),
      ],
    });

    // The control proves probing really happened: the honest one came back.
    expect(result.verified).toEqual(["honest"]);
    expect(result.inconclusive).toBe(false);
    expect(result.rejected.sort()).toEqual(["poster", "schemeless", "stealer"]);
    expect(reached.join(" ")).not.toContain("evil.test");
  });
});
