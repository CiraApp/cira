import { describe, expect, it } from "vitest";
import {
  describeSchedule,
  nextRuns,
  parseSchedule,
  shortestGapMinutes,
} from "./schedule.js";

const read = (expression: string) => {
  const parsed = parseSchedule(expression);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.schedule;
};

const from = new Date("2026-09-19T12:34:56Z");
const iso = (dates: Date[]) => dates.map((d) => d.toISOString());

describe("parseSchedule", () => {
  it("reads the notation repositories already use", () => {
    for (const ok of [
      "*/5 * * * *",
      "0 9 * * 1",
      "25 8 * * *",
      "0 0 1 * *",
      "0 9 * * mon-fri",
      "15 */6 * * *",
      "0 0 * JAN,JUL SUN",
      "@daily",
      "5/15 * * * *",
    ]) {
      expect({ ok, parsed: parseSchedule(ok).ok }).toEqual({ ok, parsed: true });
    }
  });

  it("says what is wrong with one it cannot run", () => {
    const cases: Array<[string, string]> = [
      ["* * * *", "five parts"],
      ["60 * * * *", '"60" is not a minute'],
      ["0 24 * * *", '"24" is not a hour'],
      ["0 0 L * *", '"L" is not a day of month'],
      ["0 0 * * 1#2", '"1#2" is not a day of week'],
      ["*/0 * * * *", '"*/0" is not a minute'],
      ["@reboot", "five parts"],
    ];
    for (const [expression, says] of cases) {
      const parsed = parseSchedule(expression);
      expect(parsed.ok).toBe(false);
      expect({ expression, error: !parsed.ok && parsed.error }).toMatchObject({
        expression,
        error: expect.stringContaining(says),
      });
    }
  });
});

describe("nextRuns", () => {
  it("finds the next times in UTC", () => {
    expect(iso(nextRuns(read("*/15 * * * *"), from, 3))).toEqual([
      "2026-09-19T12:45:00.000Z",
      "2026-09-19T13:00:00.000Z",
      "2026-09-19T13:15:00.000Z",
    ]);
    // 2026-09-19 is a Saturday; the next Monday is the 21st.
    expect(iso(nextRuns(read("0 9 * * 1"), from, 2))).toEqual([
      "2026-09-21T09:00:00.000Z",
      "2026-09-28T09:00:00.000Z",
    ]);
    expect(iso(nextRuns(read("0 0 1 * *"), from, 1))).toEqual([
      "2026-10-01T00:00:00.000Z",
    ]);
  });

  it("matches either day field when both are given, as cron does", () => {
    // The 1st of the month, or any Monday.
    const runs = iso(nextRuns(read("0 0 1 * 1"), from, 3));
    expect(runs).toEqual([
      "2026-09-21T00:00:00.000Z",
      "2026-09-28T00:00:00.000Z",
      "2026-10-01T00:00:00.000Z",
    ]);
  });
});

describe("shortestGapMinutes", () => {
  it("is the least time between two runs", () => {
    expect(shortestGapMinutes(read("*/5 * * * *"), from)).toBe(5);
    expect(shortestGapMinutes(read("0 9 * * 1"), from)).toBe(7 * 24 * 60);
    expect(shortestGapMinutes(read("0,10 * * * *"), from)).toBe(10);
    // Wave's three nightly tasks, each on its own, are a day apart.
    expect(shortestGapMinutes(read("25 8 * * *"), from)).toBe(24 * 60);
  });
});

describe("describeSchedule", () => {
  it("says common timetables in words, with the zone", () => {
    const cases: Array<[string, string]> = [
      ["*/5 * * * *", "Every 5 minutes"],
      ["15 * * * *", "Every hour at :15"],
      ["0 */6 * * *", "Every 6 hours at :00"],
      ["25 8 * * *", "Every day at 08:25 UTC"],
      ["0 9 * * 1", "Mondays at 09:00 UTC"],
      ["0 9 * * 1-5", "Weekdays at 09:00 UTC"],
      ["0 0 1 * *", "On day 1 of every month at 00:00 UTC"],
      ["@daily", "Every day at 00:00 UTC"],
    ];
    for (const [expression, words] of cases) {
      expect({ expression, words: describeSchedule(read(expression)) }).toEqual({
        expression,
        words,
      });
    }
  });

  it("falls back to the expression itself, still naming the zone", () => {
    expect(describeSchedule(read("0 9 1,15 * 1"))).toBe("0 9 1,15 * 1 (UTC)");
  });
});
