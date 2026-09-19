import { describe, expect, it } from "vitest";
import { appOrigin, sendEmail } from "./email";

/** Sending through Resend, and not sending at all when there is no key. */
describe("sendEmail", () => {
  const email = {
    to: "sam@acme.test",
    subject: "Hi",
    text: "Hello",
    html: "<p>Hello</p>",
  };

  it("sends nothing without a key, and says so", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response("{}");
    }) as unknown as typeof fetch;
    expect(await sendEmail(email, {}, fetchImpl)).toEqual({
      sent: false,
      reason: "not-configured",
    });
    expect(called).toBe(false);
  });

  it("sends one email to one person, from Cira", async () => {
    let body: Record<string, unknown> = {};
    let auth = "";
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      auth = new Headers(init.headers).get("authorization") ?? "";
      return new Response(JSON.stringify({ id: "e1" }));
    }) as unknown as typeof fetch;
    expect(await sendEmail(email, { RESEND_API_KEY: "re_test" }, fetchImpl)).toEqual({
      sent: true,
    });
    expect(auth).toBe("Bearer re_test");
    expect(body).toMatchObject({
      from: "Cira <notifications@cira.dev>",
      to: ["sam@acme.test"],
      subject: "Hi",
    });
  });

  it("reports a refusal or an unreachable provider without throwing", async () => {
    const refusing = (async () =>
      new Response("{}", { status: 422 })) as unknown as typeof fetch;
    expect(await sendEmail(email, { RESEND_API_KEY: "k" }, refusing)).toEqual({
      sent: false,
      reason: "refused",
    });
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await sendEmail(email, { RESEND_API_KEY: "k" }, down)).toEqual({
      sent: false,
      reason: "unreachable",
    });
  });

  it("links to Cira's own address, however it is written", () => {
    expect(appOrigin({})).toBe("https://cira.dev");
    expect(appOrigin({ CIRA_APP_URL: "http://localhost:3000/" })).toBe(
      "http://localhost:3000",
    );
  });
});
