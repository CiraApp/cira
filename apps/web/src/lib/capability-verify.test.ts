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

    expect(result.callable).toEqual(["listOrders"]);
    expect(result.absent).toEqual(["listGhosts"]);
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

    expect(result.callable).toEqual(["createOrder"]);
    expect(result.absent).toEqual(["replaceOrder"]);
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

    expect(result).toEqual({ callable: [], refused: [], absent: [], inconclusive: true });
  });

  it("puts a harmless value where a path parameter goes", async () => {
    const { fetcher, seen } = app({ "/api/v1/orders/cira-probe": ["GET"] });

    const result = await verifyCapabilities({
      ...base,
      fetcher,
      capabilities: [read("getOrder", "/api/v1/orders/{order_id}")],
    });

    expect(result.callable).toEqual(["getOrder"]);
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
   * This test used to assert the opposite - that a 401 confirmed the
   * capability - and asserting that is what published nineteen of Wave's
   * routes to agents as ready to call when not one of them could be called.
   *
   * Both halves of it are real answers and they are different answers. The
   * route is there, so it is not deleted; Cira cannot get through it, so it
   * is not offered. There was no third state to put that in, so it went in
   * the wrong one.
   */
  it("separates a route that refuses from one that is not there", async () => {
    const fetcher = async (url: string): Promise<Response> =>
      new URL(url).pathname === "/api/v1/orders"
        ? new Response(null, { status: 401 })
        : new Response(null, { status: 404 });

    const result = await verifyCapabilities({
      ...base,
      fetcher,
      capabilities: [read("listOrders", "/api/v1/orders")],
    });

    expect(result.refused).toEqual(["listOrders"]);
    expect(result.callable).toEqual([]);
    expect(result.absent).toEqual([]);
  });

  it("treats a forbidden route the same as an unauthorized one", async () => {
    const fetcher = async (url: string): Promise<Response> =>
      new URL(url).pathname === "/api/v1/orders"
        ? new Response(null, { status: 403 })
        : new Response(null, { status: 404 });

    const result = await verifyCapabilities({
      ...base,
      fetcher,
      capabilities: [read("listOrders", "/api/v1/orders")],
    });

    expect(result.refused).toEqual(["listOrders"]);
  });

  /**
   * A refusal is about the door, not about the room. Anything the app's own
   * code produced - a 400 saying the probe value was wrong, a 500 from inside
   * the handler - means Cira got through, which is the thing being measured.
   */
  it("counts a route that answered badly as one Cira can reach", async () => {
    const fetcher = async (url: string): Promise<Response> => {
      const { pathname } = new URL(url);
      if (pathname === "/api/v1/orders") return new Response(null, { status: 422 });
      if (pathname === "/api/v1/reports") return new Response(null, { status: 500 });
      return new Response(null, { status: 404 });
    };

    const result = await verifyCapabilities({
      ...base,
      fetcher,
      capabilities: [
        read("listOrders", "/api/v1/orders"),
        read("listReports", "/api/v1/reports"),
      ],
    });

    expect(result.callable.sort()).toEqual(["listOrders", "listReports"]);
    expect(result.refused).toEqual([]);
  });

  it("refuses a write whose methods the app will not disclose", async () => {
    const fetcher = async (url: string): Promise<Response> =>
      new URL(url).pathname === "/api/v1/orders"
        ? new Response(null, { status: 401 })
        : new Response(null, { status: 404 });

    const result = await verifyCapabilities({
      ...base,
      fetcher,
      capabilities: [write("createOrder", "POST", "/api/v1/orders")],
    });

    expect(result.refused).toEqual(["createOrder"]);
    expect(result.absent).toEqual([]);
  });

  /**
   * The other half of the same mistake, in the other direction: `ask` returns
   * null when the app did not answer at all, and that used to be read as
   * "no such route" - which deleted the capability. Its own comment said that
   * was not the intent.
   */
  it("leaves a capability alone when the app did not answer about it", async () => {
    const fetcher = async (url: string): Promise<Response> => {
      const { pathname } = new URL(url);
      // The control still answers, so the run itself is conclusive.
      if (pathname.startsWith("/__cira-probe-")) {
        return new Response(null, { status: 404 });
      }
      if (pathname === "/api/v1/orders") throw new Error("timed out");
      return new Response("{}", { status: 200 });
    };

    const result = await verifyCapabilities({
      ...base,
      fetcher,
      capabilities: [
        read("listOrders", "/api/v1/orders"),
        read("listReports", "/api/v1/reports"),
      ],
    });

    expect(result.inconclusive).toBe(false);
    expect(result.callable).toEqual(["listReports"]);
    // Named nowhere, so nothing is recorded for it and it is asked again.
    expect([...result.refused, ...result.absent]).not.toContain("listOrders");
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
    expect(result).toEqual({
      callable: [],
      refused: [],
      absent: [],
      inconclusive: false,
    });
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
    expect(result.callable).toEqual(["honest"]);
    expect(result.inconclusive).toBe(false);
    expect(result.absent.sort()).toEqual(["poster", "schemeless", "stealer"]);
    expect(reached.join(" ")).not.toContain("evil.test");
  });
});
