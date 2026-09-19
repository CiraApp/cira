import { describe, expect, it } from "vitest";
import type { Event } from "@sentry/nextjs";
import { scrub, sentryOptions } from "./sentry-options";

/**
 * What leaves Cira in an error report. A deploy request carries an app's
 * secrets in its body, so the body - and anything else a request brought
 * with it - must be gone before an event is sent.
 */
describe("scrub", () => {
  it("keeps where a request went and drops everything it carried", () => {
    const event: Event = {
      request: {
        url: "https://cira.dev/api/cli/deploy?device_code=abc",
        method: "POST",
        data: { env: { DATABASE_URL: "postgres://user:secret@db/app" } },
        cookies: { __session: "jwt" },
        query_string: "device_code=abc",
        headers: {
          Authorization: "Bearer cli-token",
          Cookie: "__session=jwt",
          "User-Agent": "cira-cli/0.5.2",
        },
      },
    };
    const sent = JSON.stringify(scrub(event));
    expect(scrub(event).request).toEqual({
      url: "https://cira.dev/api/cli/deploy",
      method: "POST",
      headers: { "user-agent": "cira-cli/0.5.2" },
    });
    for (const secret of ["secret", "jwt", "cli-token", "abc"]) {
      expect(sent).not.toContain(secret);
    }
  });

  it("leaves an event with no request alone", () => {
    expect(scrub({ message: "boom" })).toEqual({ message: "boom" });
  });

  it("sends nothing about a person, and nothing at all without a DSN", () => {
    expect(sentryOptions.sendDefaultPii).toBe(false);
    // Tests run with no DSN, as development does.
    expect(sentryOptions.enabled).toBe(false);
  });
});
