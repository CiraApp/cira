import { describe, expect, it } from "vitest";
import {
  DRILL_LIMIT_MS,
  checkDrill,
  checkProxy,
  combine,
  healthResponse,
} from "./health";

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

  it("is up only when every part is, and names each part that is not", () => {
    expect(combine([{ ok: true }, { ok: true }])).toEqual({ ok: true });
    expect(
      combine([
        { ok: false, failing: "database" },
        { ok: true },
        { ok: false, failing: "app proxy" },
      ]),
    ).toEqual({ ok: false, failing: "database, app proxy" });
  });

  it("fails on purpose during a drill, and stops on its own", () => {
    const now = Date.parse("2026-09-23T07:00:00Z");

    expect(checkDrill("2026-09-23T07:10:00Z", now)).toEqual({
      ok: false,
      failing: "drill",
    });
    // Over once the moment passes, with nobody turning it off.
    expect(checkDrill("2026-09-23T06:59:59Z", now)).toEqual({ ok: true });
    // Never set, or set to nonsense: no drill.
    expect(checkDrill(undefined, now)).toEqual({ ok: true });
    expect(checkDrill("soon", now)).toEqual({ ok: true });
    // A moment too far away is a mistake, not a long drill.
    expect(checkDrill(new Date(now + DRILL_LIMIT_MS + 1000).toISOString(), now)).toEqual({
      ok: true,
    });
  });
});
