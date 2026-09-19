import { describe, expect, it } from "vitest";
import { checkProxy, healthResponse } from "./health";

/** The app proxy counts as up only when it answers as itself. */
describe("checkProxy", () => {
  const answering = (status: number, body: string) =>
    (async () => new Response(body, { status })) as unknown as typeof fetch;

  it("is up when the proxy turns away a stranger in its own words", async () => {
    let asked = "";
    const fetchImpl = (async (url: string) => {
      asked = url;
      return new Response("Not signed in", { status: 401 });
    }) as unknown as typeof fetch;
    expect(await checkProxy("cira.dev", fetchImpl)).toEqual({ ok: true });
    expect(asked).toBe("https://health--check.cira.dev/");
  });

  it("is down for anything else: an error, Cloudflare's page, or no answer", async () => {
    const down = { ok: false, failing: "app proxy" };
    expect(await checkProxy("cira.dev", answering(502, "Bad gateway"))).toEqual(down);
    expect(
      await checkProxy("cira.dev", answering(401, "<html>error 1101</html>")),
    ).toEqual(down);
    const refused = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await checkProxy("cira.dev", refused)).toEqual(down);
  });

  it("answers a monitor with a status it can read, never cached", async () => {
    const up = healthResponse({ ok: true });
    expect(up.status).toBe(200);
    expect(up.headers.get("cache-control")).toBe("no-store");
    expect(healthResponse({ ok: false, failing: "database" }).status).toBe(503);
  });
});
