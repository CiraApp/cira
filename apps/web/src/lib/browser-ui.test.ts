import { describe, expect, it, vi } from "vitest";
import { probeWebUi } from "./browser-ui";

const base = { origin: "https://app.example", token: "tok" };

function answers(init: ResponseInit & { body?: string }) {
  const { body, ...rest } = init;
  return vi.fn(async () => new Response(body ?? null, rest));
}

describe("probeWebUi", () => {
  it("asks the app's root, with the credential that opens it", async () => {
    const fetcher = answers({ status: 200, headers: { "content-type": "text/html" } });
    await probeWebUi({ ...base, fetcher });

    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://app.example/");
    expect(new Headers(init.headers).get("x-serverless-authorization")).toBe(
      "Bearer tok",
    );
  });

  /**
   * The one header that distinguishes this from every other probe Cira sends.
   * An app that negotiates on `Accept` would answer a JSON request with JSON
   * and be written off as headless while serving a perfectly good page.
   */
  it("asks for HTML rather than JSON", async () => {
    const fetcher = answers({ status: 200, headers: { "content-type": "text/html" } });
    await probeWebUi({ ...base, fetcher });

    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("accept")).toContain("text/html");
  });

  it("reads an HTML page as a front door", async () => {
    const fetcher = answers({
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    await expect(probeWebUi({ ...base, fetcher })).resolves.toBe(true);
  });

  it("reads a redirect as a front door, without following it", async () => {
    // `/` sending a browser to `/login` is a website behaving normally.
    const fetcher = answers({ status: 302, headers: { location: "/login" } });
    await expect(probeWebUi({ ...base, fetcher })).resolves.toBe(true);

    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.redirect).toBe("manual");
  });

  it("reads a missing root as no front door", async () => {
    const fetcher = answers({ status: 404 });
    await expect(probeWebUi({ ...base, fetcher })).resolves.toBe(false);
  });

  it("reads a JSON root as no front door", async () => {
    // An API that lists its own endpoints at `/` is still not somewhere to
    // send a person.
    const fetcher = answers({
      status: 200,
      headers: { "content-type": "application/json" },
      body: '{"name":"wave-api"}',
    });
    await expect(probeWebUi({ ...base, fetcher })).resolves.toBe(false);
  });

  /**
   * The third answer, and the one that keeps this from doing damage. None of
   * these mean "no web interface", and concluding that would take the way into
   * a working app away from everyone who uses it.
   */
  it("concludes nothing from an answer that settles nothing", async () => {
    for (const status of [401, 403, 405, 500, 503]) {
      const fetcher = answers({ status });
      await expect(probeWebUi({ ...base, fetcher }), String(status)).resolves.toBeNull();
    }
  });

  it("concludes nothing when the app cannot be reached", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    await expect(probeWebUi({ ...base, fetcher })).resolves.toBeNull();
  });

  it("concludes nothing from a 200 that names no type", async () => {
    const fetcher = answers({ status: 200 });
    await expect(probeWebUi({ ...base, fetcher })).resolves.toBeNull();
  });
});
