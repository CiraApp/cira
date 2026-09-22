import { describe, expect, it } from "vitest";
import { UpstashCaches, UpstashError, upstashConfigFromEnv } from "./caches.js";

const config = { email: "ops@cira.dev", apiKey: "key", region: "us-central1" };

function fake(
  answer: (method: string, path: string) => { status: number; body: string },
) {
  const calls: Array<{
    method: string;
    path: string;
    body: unknown;
    auth: string | null;
  }> = [];
  const impl = (async (input: string | URL, init?: RequestInit) => {
    const path = String(input).replace("https://api.upstash.com/v2/redis", "");
    const method = init?.method ?? "GET";
    calls.push({
      method,
      path,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      auth: new Headers(init?.headers).get("authorization"),
    });
    const reply = answer(method, path);
    return new Response(reply.body, { status: reply.status });
  }) as typeof fetch;
  return { impl, calls };
}

const made = JSON.stringify({
  database_id: "db-1",
  endpoint: "calm-owl-1.upstash.io",
  port: 6379,
  password: "p@ss/word",
});

describe("UpstashCaches", () => {
  it("makes a TLS cache on Google in the apps' region, and gives the address a client takes", async () => {
    const { impl, calls } = fake(() => ({ status: 200, body: made }));
    const cache = await new UpstashCaches(config, impl).create("acme-orders");
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/database",
      body: {
        database_name: "acme-orders",
        platform: "gcp",
        primary_region: "us-central1",
        tls: true,
      },
      auth: `Basic ${Buffer.from("ops@cira.dev:key").toString("base64")}`,
    });
    expect(cache).toEqual({
      id: "db-1",
      url: "rediss://default:p%40ss%2Fword@calm-owl-1.upstash.io:6379",
    });
  });

  it("asks for the address again rather than keeping it", async () => {
    const { impl, calls } = fake(() => ({ status: 200, body: made }));
    expect(await new UpstashCaches(config, impl).url("db-1")).toContain(
      "@calm-owl-1.upstash.io:6379",
    );
    expect(calls[0]).toMatchObject({ method: "GET", path: "/database/db-1" });
  });

  it("counts a cache already gone as removed, and says what Upstash said otherwise", async () => {
    const gone = new UpstashCaches(
      config,
      fake(() => ({ status: 404, body: '"database not found"' })).impl,
    );
    await expect(gone.remove("db-1")).resolves.toBeUndefined();
    const refused = new UpstashCaches(
      config,
      fake(() => ({ status: 400, body: '"free database limit reached"' })).impl,
    );
    await expect(refused.create("x")).rejects.toEqual(
      new UpstashError("free database limit reached", 400),
    );
  });
});

describe("a full Upstash plan", () => {
  it("comes back in Upstash's own words, which the app layer turns into advice", async () => {
    const full = new UpstashCaches(
      config,
      fake(() => ({
        status: 400,
        body: '"You cannot have more than 1 database(s). You can add a payment method to create more in pay as you go plan."',
      })).impl,
    );
    await expect(full.create("x")).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("more than 1 database"),
    });
  });
});

describe("upstashConfigFromEnv", () => {
  it("is null until the account and its key are both set", () => {
    expect(upstashConfigFromEnv({ UPSTASH_EMAIL: "a" })).toBeNull();
    expect(upstashConfigFromEnv({ UPSTASH_EMAIL: "a", UPSTASH_API_KEY: "k" })).toEqual({
      email: "a",
      apiKey: "k",
      region: "us-central1",
    });
  });
});
