import { describe, expect, it } from "vitest";
import {
  MAX_MESSAGE,
  quoted,
  runtimeLogFilter,
  toRuntimeLogEntry,
  withoutControls,
} from "./runtime-logs.js";

const base = {
  service: "paradym-orders-3f9a1c2e",
  region: "us-central1",
  since: new Date("2026-09-19T13:00:00.000Z"),
  until: new Date("2026-09-19T14:00:00.000Z"),
  minimum: "all" as const,
  search: null,
};

/**
 * A filter read the way Cloud Logging reads one: string literals, where a
 * backslash escapes the next character, and everything else. Returns the
 * parts outside strings - the shape of the query - and the strings' values.
 */
function read(filter: string): { shape: string; strings: string[] } {
  let shape = "";
  const strings: string[] = [];
  for (let i = 0; i < filter.length; i += 1) {
    if (filter[i] !== '"') {
      shape += filter[i];
      continue;
    }
    let value = "";
    for (i += 1; i < filter.length && filter[i] !== '"'; i += 1) {
      if (filter[i] === "\\") i += 1;
      value += filter[i] ?? "";
    }
    if (i >= filter.length) throw new Error("A string was never closed.");
    shape += "S";
    strings.push(value);
  }
  return { shape, strings };
}

describe("runtimeLogFilter", () => {
  it("reads one service's lines in one slice of time", () => {
    expect(runtimeLogFilter(base)).toBe(
      [
        'resource.type = "cloud_run_revision"',
        'resource.labels.service_name = "paradym-orders-3f9a1c2e"',
        'resource.labels.location = "us-central1"',
        'timestamp >= "2026-09-19T13:00:00.000Z"',
        'timestamp <= "2026-09-19T14:00:00.000Z"',
      ].join(" AND "),
    );
  });

  it("reads one revision when asked, and refuses a name that is not one", () => {
    expect(
      runtimeLogFilter({ ...base, revision: "paradym-orders-3f9a1c2e-00007-xoz" }),
    ).toContain(
      'resource.labels.service_name = "paradym-orders-3f9a1c2e" AND resource.labels.revision_name = "paradym-orders-3f9a1c2e-00007-xoz"',
    );
    expect(() => runtimeLogFilter({ ...base, revision: 'x" OR "1"="1' })).toThrow();
  });

  it("narrows by level using Google's own severities", () => {
    expect(runtimeLogFilter({ ...base, minimum: "warning" })).toMatch(
      / AND severity >= WARNING$/,
    );
    expect(runtimeLogFilter({ ...base, minimum: "error" })).toMatch(
      / AND severity >= ERROR$/,
    );
  });

  it("looks for a search in the message and the path", () => {
    const filter = runtimeLogFilter({ ...base, search: "ord_1002" });
    expect(filter).toContain(
      '(textPayload : "ord_1002" OR jsonPayload.message : "ord_1002" OR httpRequest.requestUrl : "ord_1002")',
    );
    // Nothing to look for is no clause at all, not a match for everything.
    expect(runtimeLogFilter({ ...base, search: "   " })).toBe(runtimeLogFilter(base));
  });

  /**
   * The case this module exists to get right. Whatever is typed into the
   * search box, the query around it keeps exactly the same shape, and the
   * text comes back out of its string unchanged - so it was only ever looked
   * for, and never read as more of the query.
   */
  it("cannot be widened by anything typed into the search", () => {
    const expected = read(runtimeLogFilter({ ...base, search: "harmless" })).shape;

    for (const attack of [
      '" OR resource.labels.service_name : "',
      '\\" OR severity >= DEFAULT OR "',
      "x\\",
      '\\\\" OR "',
      '"',
      '") OR (resource.type = "gce_instance',
      'a"\nOR logName : "b',
      '\u0000" OR "',
    ]) {
      const { shape, strings } = read(runtimeLogFilter({ ...base, search: attack }));
      expect({ attack, shape }).toEqual({ attack, shape: expected });
      // The service is still this one, and the search is the text as typed,
      // less the control characters that were never meant to be in it.
      expect(strings[1]).toBe("paradym-orders-3f9a1c2e");
      const typed = withoutControls(attack).trim();
      expect(strings.slice(5)).toEqual([typed, typed, typed]);
    }
  });

  it("reads a scheduled run's or a worker's lines instead, by their own resource", () => {
    expect(
      runtimeLogFilter({ ...base, target: { type: "job", name: "report-3f9a1c2e" } }),
    ).toContain(
      'resource.type = "cloud_run_job" AND resource.labels.job_name = "report-3f9a1c2e"',
    );
    expect(
      runtimeLogFilter({
        ...base,
        target: { type: "worker-pool", name: "worker-3f9a1c2e" },
      }),
    ).toContain(
      'resource.type = "cloud_run_worker_pool" AND resource.labels.worker_pool_name = "worker-3f9a1c2e"',
    );
    expect(() =>
      runtimeLogFilter({ ...base, target: { type: "job", name: 'x" OR "' } }),
    ).toThrow();
  });

  it("refuses a service or region that is not shaped like one", () => {
    expect(() =>
      runtimeLogFilter({ ...base, service: 'x" OR resource.type : "' }),
    ).toThrow();
    expect(() => runtimeLogFilter({ ...base, region: "us central1" })).toThrow();
  });

  it("keeps a search to a sensible length", () => {
    const { strings } = read(quoted("a".repeat(5000)));
    expect(strings[0]).toHaveLength(200);
  });
});

describe("toRuntimeLogEntry", () => {
  it("reads a line the app printed", () => {
    const entry = toRuntimeLogEntry({
      insertId: "abc",
      timestamp: "2026-09-19T14:02:11.519Z",
      severity: "ERROR",
      logName: "projects/p/logs/run.googleapis.com%2Fstderr",
      textPayload: 'Traceback (most recent call last):\n  File "app.py"\nTypeError: x\n',
    });

    expect(entry).toMatchObject({
      id: "abc",
      level: "error",
      message: 'Traceback (most recent call last):\n  File "app.py"\nTypeError: x',
      request: null,
      truncated: false,
    });
    expect(entry.timestamp.toISOString()).toBe("2026-09-19T14:02:11.519Z");
  });

  it("turns Cloud Run's record of a request into one line", () => {
    const entry = toRuntimeLogEntry({
      insertId: "r1",
      timestamp: "2026-09-19T14:02:11.522Z",
      severity: "ERROR",
      httpRequest: {
        requestMethod: "GET",
        requestUrl:
          "https://orders-abc-uc.a.run.app/revenue?start=2026-08-01&end=2026-08-31",
        status: 500,
        latency: "0.212404s",
      },
    });

    expect(entry.request).toEqual({
      method: "GET",
      path: "/revenue?start=2026-08-01&end=2026-08-31",
      status: 500,
      latencyMs: 212,
    });
    expect(entry.message).toBe("");
  });

  it("reads a structured line by its message, and shows one without as JSON", () => {
    expect(
      toRuntimeLogEntry({ jsonPayload: { message: "refund issued", order: "ord_1" } })
        .message,
    ).toBe("refund issued");
    expect(toRuntimeLogEntry({ jsonPayload: { order: "ord_1" } }).message).toBe(
      '{"order":"ord_1"}',
    );
  });

  it("grades by what a person does about it", () => {
    const level = (severity?: string) =>
      toRuntimeLogEntry(severity === undefined ? {} : { severity }).level;
    expect(level(undefined)).toBe("default");
    expect(level("DEFAULT")).toBe("default");
    expect(level("NOTICE")).toBe("info");
    expect(level("WARNING")).toBe("warning");
    expect(level("CRITICAL")).toBe("error");
    expect(level("EMERGENCY")).toBe("error");
  });

  it("cuts a very long line, and says so", () => {
    const entry = toRuntimeLogEntry({ textPayload: "x".repeat(MAX_MESSAGE + 10) });
    expect(entry.message).toHaveLength(MAX_MESSAGE);
    expect(entry.truncated).toBe(true);
  });

  it("names the container a line came from, when Cloud Run does", () => {
    expect(
      toRuntimeLogEntry({ textPayload: "up", labels: { container_name: "api" } })
        .container,
    ).toBe("api");
    expect(toRuntimeLogEntry({ textPayload: "up" }).container).toBeNull();
  });
});
