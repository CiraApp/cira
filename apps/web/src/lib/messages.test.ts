import { describe, expect, it } from "vitest";
import {
  deployFailedMessage,
  inviteMessage,
  notAnsweringMessage,
  refusedMessage,
  runFailedMessage,
  utc,
} from "./messages";

/** What Cira's emails say, and that nothing a user named can break out of them. */
describe("messages", () => {
  const app = {
    name: "Revenue <b>Board</b>",
    spaceName: "Acme & Co",
    page: "https://cira.dev/acme/revenue",
  };

  it("escapes every name on its way into HTML, and keeps it as written in text", () => {
    const message = deployFailedMessage({
      app,
      startedAt: new Date("2026-09-19T12:00:00Z"),
      stillRunningEarlier: true,
    });
    expect(message.html).not.toContain("<b>Board</b>");
    expect(message.html).toContain("Revenue &lt;b&gt;Board&lt;/b&gt;");
    expect(message.html).toContain("Acme &amp; Co");
    expect(message.text).toContain("Revenue <b>Board</b>");
    expect(message.text).toContain("still running");
    expect(message.text).toContain("https://cira.dev/acme/revenue");
  });

  it("says a first deploy that failed left nothing running", () => {
    const message = deployFailedMessage({
      app,
      startedAt: new Date(),
      stillRunningEarlier: false,
    });
    expect(message.text).toContain("not running yet");
  });

  it("gives times in UTC, which a reader anywhere can place", () => {
    expect(utc(new Date("2026-09-19T09:05:00Z"))).toBe("Sat, Sep 19, 09:05 UTC");
  });

  it("points a run that ran out of memory at the fix, and any other at its logs", () => {
    const base = {
      app,
      run: "weekly-report",
      startedAt: new Date("2026-09-19T09:00:00Z"),
      nextRunAt: new Date("2026-09-21T09:00:00Z"),
      logs: "https://cira.dev/acme/revenue/logs?process=weekly-report",
    };
    const memory = runFailedMessage({ ...base, outOfMemory: true });
    expect(memory.subject).toBe("Revenue <b>Board</b>: weekly-report failed");
    expect(memory.text).toContain("ran out of memory");
    expect(memory.text).toContain(`Open Revenue <b>Board</b>: ${app.page}`);
    const other = runFailedMessage({ ...base, outOfMemory: false });
    expect(other.text).toContain(`Open that run's logs: ${base.logs}`);
    expect(other.text).toContain("It runs next Mon, Sep 21, 09:00 UTC.");
  });

  it("names a worker that keeps stopping, and why", () => {
    const message = notAnsweringMessage({
      app,
      worker: "worker",
      since: new Date("2026-09-19T11:58:00Z"),
      why: "it keeps running out of memory and being restarted",
      logs: "https://cira.dev/acme/revenue/logs?process=worker",
    });
    // Most Procfiles call theirs "worker"; "the worker worker" read as a typo.
    expect(message.subject).toContain(": its worker keeps stopping");
    expect(message.text).toContain("Its worker of Revenue");
    expect(message.text).toContain("it keeps running out of memory");

    const named = notAnsweringMessage({
      app,
      worker: "ingest",
      since: new Date("2026-09-19T11:58:00Z"),
      why: null,
      logs: "https://cira.dev/acme/revenue/logs?process=ingest",
    });
    expect(named.subject).toContain(": the worker \u201cingest\u201d keeps stopping");
  });

  it("says a refused capability is decided in the app, not in Cira", () => {
    const message = refusedMessage({ app, operation: "Create refund" });
    expect(message.subject).toBe(
      "Revenue <b>Board</b>: Create refund stopped letting Cira in",
    );
    expect(message.text).toContain("No setting in Cira changes that");
  });

  it("invites someone by name, to one address, until a date", () => {
    const message = inviteMessage({
      inviter: "Aumit",
      spaceName: "Paradym",
      role: "admin",
      email: "sam@paradym.test",
      url: "https://cira.dev/invite/abc",
      expiresAt: new Date("2026-09-26T12:00:00Z"),
    });
    expect(message.subject).toBe("Aumit invited you to Paradym on Cira");
    expect(message.text).toContain("as an admin");
    expect(message.text).toContain("for sam@paradym.test and works once");
    expect(message.html).toContain('href="https://cira.dev/invite/abc"');
  });
});
