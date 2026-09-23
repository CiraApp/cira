import { describe, expect, it } from "vitest";
import { AROUND_MS, logWindow } from "./runtime-logs.js";

const now = new Date("2026-09-19T14:00:00.000Z");

describe("logWindow", () => {
  it("reaches the end of a run that took a while, not only the minute after it began", () => {
    const now = new Date("2026-09-23T12:00:00.000Z");
    const started = new Date("2026-09-23T09:54:12.000Z");
    const ended = new Date("2026-09-23T09:56:32.000Z");
    expect(logWindow({ around: started, through: ended }, now)).toEqual({
      since: new Date(started.getTime() - AROUND_MS),
      until: new Date(ended.getTime() + AROUND_MS),
    });
    // An end before the start is no end at all.
    expect(logWindow({ around: ended, through: started }, now)?.until).toEqual(
      new Date(ended.getTime() + AROUND_MS),
    );
  });

  it("ends a named range now", () => {
    expect(logWindow({ range: "1h" }, now)).toEqual({
      since: new Date("2026-09-19T13:00:00.000Z"),
      until: now,
    });
    expect(logWindow({ range: "7d" }, now)?.since).toEqual(
      new Date("2026-09-12T14:00:00.000Z"),
    );
  });

  it("puts a run in the middle of a minute either side", () => {
    const at = new Date("2026-09-19T12:30:00.000Z");
    expect(logWindow({ around: at }, now)).toEqual({
      since: new Date(at.getTime() - AROUND_MS),
      until: new Date(at.getTime() + AROUND_MS),
    });
  });

  it("does not reach past now for a run that just happened", () => {
    const at = new Date(now.getTime() - 10_000);
    expect(logWindow({ around: at }, now)?.until).toEqual(now);
  });

  it("refuses a moment nobody could have logs for", () => {
    expect(logWindow({ around: new Date("not a date") }, now)).toBeNull();
    expect(logWindow({ around: new Date("2026-10-01T00:00:00Z") }, now)).toBeNull();
    expect(logWindow({ around: new Date("2026-07-01T00:00:00Z") }, now)).toBeNull();
    expect(logWindow({ range: "1y" as never }, now)).toBeNull();
  });
});
