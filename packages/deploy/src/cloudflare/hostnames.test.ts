import { describe, expect, it } from "vitest";
import { CloudflareError, CloudflareHostnames } from "./hostnames.js";

const config = { apiToken: "cf_test", zoneId: "zone1", target: "domains.cira.dev" };

function fake(answer: (method: string, path: string, body: unknown) => unknown) {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  const impl = (async (input: string | URL, init?: RequestInit) => {
    const path = String(input).replace(
      "https://api.cloudflare.com/client/v4/zones/zone1",
      "",
    );
    const method = init?.method ?? "GET";
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
    calls.push(`${method} ${path}`);
    bodies.push(body);
    const result = answer(method, path, body);
    if (result instanceof Response) return result;
    return Response.json({ success: true, result });
  }) as typeof fetch;
  return { impl, calls, bodies };
}

describe("CloudflareHostnames", () => {
  it("asks for a certificate proved over HTTP, and reads back where it has got to", async () => {
    const { impl, bodies } = fake(() => ({
      id: "h1",
      hostname: "tools.acme.com",
      status: "pending",
      ssl: { status: "pending_validation" },
      verification_errors: ["custom hostname does not CNAME to this zone."],
    }));
    const made = await new CloudflareHostnames(config, impl).create("tools.acme.com");
    expect(bodies[0]).toMatchObject({
      hostname: "tools.acme.com",
      ssl: { method: "http", type: "dv" },
    });
    expect(made).toEqual({
      id: "h1",
      hostname: "tools.acme.com",
      state: "pending",
      reason: "custom hostname does not CNAME to this zone.",
    });
  });

  it("is active only once the name and its certificate both are", async () => {
    const answer = (status: string, ssl: string) =>
      new CloudflareHostnames(
        config,
        fake(() => ({ id: "h1", hostname: "t.acme.com", status, ssl: { status: ssl } }))
          .impl,
      ).get("h1");
    expect((await answer("active", "pending_validation"))?.state).toBe("pending");
    expect((await answer("active", "active"))?.state).toBe("active");
    expect((await answer("pending", "timed_out"))?.state).toBe("failed");
  });

  it("counts a hostname already gone as removed, and as nothing when asked about", async () => {
    const gone = () =>
      Response.json(
        { success: false, errors: [{ code: 1436, message: "not found" }] },
        { status: 404 },
      );
    const client = new CloudflareHostnames(config, fake(gone).impl);
    await expect(client.remove("h1")).resolves.toBeUndefined();
    await expect(client.get("h1")).resolves.toBeNull();
  });

  it("says what Cloudflare said when it refuses", async () => {
    const refuse = () =>
      Response.json(
        {
          success: false,
          errors: [{ code: 1406, message: "Duplicate custom hostname found." }],
        },
        { status: 409 },
      );
    await expect(
      new CloudflareHostnames(config, fake(refuse).impl).create("t.acme.com"),
    ).rejects.toEqual(new CloudflareError("Duplicate custom hostname found.", 409, 1406));
  });

  it("sets the zone up once, and changes nothing the second time", async () => {
    const first = fake((method, path) => {
      if (path.startsWith("/dns_records?")) return [];
      if (path === "/custom_hostnames/fallback_origin" && method === "GET")
        return { origin: null };
      if (path === "/workers/routes" && method === "GET")
        return [{ pattern: "*.cira.dev/*", script: "cira-app-proxy" }];
      return {};
    });
    expect(
      await new CloudflareHostnames(config, first.impl).ensureZone("cira-app-proxy"),
    ).toBe(true);
    expect(first.calls).toEqual([
      "GET /dns_records?name=domains.cira.dev",
      "POST /dns_records",
      "GET /custom_hostnames/fallback_origin",
      "PUT /custom_hostnames/fallback_origin",
      "GET /workers/routes",
      "POST /workers/routes",
    ]);

    const again = fake((_m, path) =>
      path.startsWith("/dns_records?")
        ? [{ id: "r1", proxied: true }]
        : path === "/custom_hostnames/fallback_origin"
          ? { origin: "domains.cira.dev" }
          : [{ pattern: "*/*", script: "cira-app-proxy" }],
    );
    expect(
      await new CloudflareHostnames(config, again.impl).ensureZone("cira-app-proxy"),
    ).toBe(false);
    expect(again.calls.every((call) => call.startsWith("GET "))).toBe(true);
  });
});
