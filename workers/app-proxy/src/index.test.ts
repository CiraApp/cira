import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signSession } from "@cira/core";
import proxy, { type Env } from "./index.js";

/**
 * The app proxy, as a browser and Cira see it. Cira is a fake behind `fetch`:
 * it knows one company hostname, and mints a token for one app.
 */

const env: Env = {
  CIRA_ORIGIN: "https://cira.dev",
  APPS_DOMAIN: "cira.dev",
  CIRA_PROXY_SECRET: "s".repeat(32),
};
const LABEL = "ledger--acme";
const APP_ORIGIN = "https://ledger-abc.a.run.app";

let asked: Array<{ url: string; body: unknown; secret: string | null }>;
let upstream: Request[];

beforeEach(() => {
  asked = [];
  upstream = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = request.url;
    if (url.startsWith(env.CIRA_ORIGIN)) {
      const body = JSON.parse(await request.text());
      asked.push({ url, body, secret: request.headers.get("x-cira-proxy-secret") });
      if (url.endsWith("/api/proxy/domain")) {
        return body.hostname === "tools.acme.com"
          ? Response.json({ label: LABEL })
          : Response.json({ error: "No app" }, { status: 404 });
      }
      return Response.json({ token: "google-id-token", origin: APP_ORIGIN });
    }
    upstream.push(request);
    return new Response("hello from the app");
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const browse = (url: string, cookie?: string) =>
  proxy.fetch(
    new Request(url, {
      headers: {
        "sec-fetch-mode": "navigate",
        accept: "text/html",
        ...(cookie === undefined ? {} : { cookie }),
      },
    }),
    env,
  );

const session = (label: string) =>
  signSession(
    {
      userId: "usr_1",
      appId: "app_1",
      label,
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    },
    env.CIRA_PROXY_SECRET,
  );

describe("the app proxy", () => {
  it("sends someone with no session to Cira, back to the app's own address", async () => {
    const response = await browse(`https://${LABEL}.cira.dev/reports?month=9`);
    expect(response.status).toBe(302);
    const to = new URL(response.headers.get("location")!);
    expect(to.origin + to.pathname).toBe(`https://cira.dev/enter/${LABEL}`);
    expect(to.searchParams.get("next")).toBe("/reports?month=9");
    expect(to.searchParams.get("host")).toBeNull();
    expect(asked).toEqual([]);
  });

  it("asks Cira which app a company's own name opens, and comes back to that name", async () => {
    const response = await browse("https://tools.acme.com/");
    const to = new URL(response.headers.get("location")!);
    expect(to.pathname).toBe(`/enter/${LABEL}`);
    expect(to.searchParams.get("host")).toBe("tools.acme.com");
    expect(asked[0]).toMatchObject({
      url: "https://cira.dev/api/proxy/domain",
      body: { hostname: "tools.acme.com" },
      secret: env.CIRA_PROXY_SECRET,
    });
  });

  it("opens the app on a company's own name, with the credential only the proxy adds", async () => {
    const response = await browse(
      "https://tools.acme.com/orders",
      `__Host-cira=${await session(LABEL)}; theme=dark`,
    );
    expect(await response.text()).toBe("hello from the app");
    const sent = upstream[0]!;
    expect(sent.url).toBe(`${APP_ORIGIN}/orders`);
    expect(sent.headers.get("x-serverless-authorization")).toBe("Bearer google-id-token");
    expect(sent.headers.get("x-forwarded-host")).toBe("tools.acme.com");
    // The app never sees the cookie that let someone in.
    expect(sent.headers.get("cookie")).toBe("theme=dark");
  });

  it("will not take one app's session on another app's name", async () => {
    const response = await browse(
      "https://tools.acme.com/",
      `__Host-cira=${await session("payroll--acme")}`,
    );
    expect(response.status).toBe(302);
    expect(upstream).toEqual([]);
  });

  it("says there is nothing at a name no app has, and remembers it", async () => {
    const first = await browse("https://nothing.example.com/");
    const second = await browse("https://nothing.example.com/again");
    expect(first.status).toBe(404);
    expect(second.status).toBe(404);
    expect(asked.filter((a) => a.url.endsWith("/api/proxy/domain"))).toHaveLength(1);
  });

  it("never asks about a name under Cira's own domain that is not an app's", async () => {
    const response = await browse("https://not-an-app.cira.dev/");
    expect(response.status).toBe(404);
    expect(asked).toEqual([]);
  });
});
