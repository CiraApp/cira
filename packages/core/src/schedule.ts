/**
 * Timetables: when a scheduled run happens, in the notation everyone already
 * writes them in.
 *
 * A timetable is a standard five-field cron expression - minute, hour, day of
 * month, month, day of week - read in UTC. That is what Procfile-era tooling,
 * GitHub Actions and Cloud Scheduler all speak, so a timetable found in a
 * repository is taken as written and handed to Google unchanged. This module
 * is the one place Cira reads one: to refuse what it cannot run, to find when
 * it runs next, to find the shortest gap between runs (which is what keeps a
 * run from overlapping the next), and to say it in words on a page.
 */

export interface Schedule {
  expression: string;
  minutes: ReadonlySet<number>;
  hours: ReadonlySet<number>;
  days: ReadonlySet<number>;
  months: ReadonlySet<number>;
  weekdays: ReadonlySet<number>;
  /** Cron's rule: when both day fields are restricted, either may match. */
  dayEither: boolean;
}

const FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day of week", min: 0, max: 7 },
] as const;

const MONTH_NAMES = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * Read a timetable, or say what is wrong with it in words a person can act on.
 *
 * Accepts numbers, `*`, lists, ranges, steps, and month and weekday names.
 * Refuses the extensions only some cron implementations have (`L`, `W`, `#`,
 * `?`, seconds, `@reboot`), because Cloud Scheduler would refuse them later
 * and it is better to hear that while typing.
 */
export function parseSchedule(
  expression: string,
): { ok: true; schedule: Schedule } | { ok: false; error: string } {
  const aliases: Record<string, string> = {
    "@hourly": "0 * * * *",
    "@daily": "0 0 * * *",
    "@midnight": "0 0 * * *",
    "@weekly": "0 0 * * 0",
    "@monthly": "0 0 1 * *",
    "@yearly": "0 0 1 1 *",
    "@annually": "0 0 1 1 *",
  };
  const trimmed = expression.trim().replace(/\s+/g, " ");
  const text = aliases[trimmed.toLowerCase()] ?? trimmed;
  const parts = text.split(" ");
  if (parts.length !== 5) {
    return {
      ok: false,
      error:
        "A timetable has five parts: minute, hour, day of month, month and day of week.",
    };
  }

  const sets: Set<number>[] = [];
  for (const [index, part] of parts.entries()) {
    const field = FIELDS[index]!;
    const read = readField(part, field.min, field.max, index);
    if (read === null) {
      return {
        ok: false,
        error: `"${part}" is not a ${field.name} a timetable can use.`,
      };
    }
    sets.push(read);
  }

  const [minutes, hours, days, months, rawWeekdays] = sets as [
    Set<number>,
    Set<number>,
    Set<number>,
    Set<number>,
    Set<number>,
  ];
  // Sunday is both 0 and 7.
  const weekdays = new Set([...rawWeekdays].map((d) => (d === 7 ? 0 : d)));

  return {
    ok: true,
    schedule: {
      expression: text,
      minutes,
      hours,
      days,
      months,
      weekdays,
      dayEither: parts[2] !== "*" && parts[4] !== "*",
    },
  };
}

function readField(
  text: string,
  min: number,
  max: number,
  index: number,
): Set<number> | null {
  const names = index === 3 ? MONTH_NAMES : index === 4 ? DAY_NAMES : null;
  const value = (raw: string): number | null => {
    const lower = raw.toLowerCase();
    if (names !== null) {
      const at = names.indexOf(lower);
      if (at !== -1) return index === 3 ? at + 1 : at;
    }
    if (!/^\d+$/.test(raw)) return null;
    const n = Number(raw);
    return n >= min && n <= max ? n : null;
  };

  const out = new Set<number>();
  for (const item of text.split(",")) {
    const [range, stepText] = item.split("/");
    if (range === undefined || range === "") return null;
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) return null;

    let from: number | null;
    let to: number | null;
    if (range === "*") {
      from = min;
      to = index === 4 ? 6 : max;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-");
      from = value(a ?? "");
      to = value(b ?? "");
    } else {
      from = value(range);
      // `5/15` means from 5, every 15, to the end of the field.
      to = stepText === undefined ? from : index === 4 ? 6 : max;
    }
    if (from === null || to === null || from > to) return null;
    for (let n = from; n <= to; n += step) out.add(n);
  }
  return out.size === 0 ? null : out;
}

function matches(schedule: Schedule, at: Date): boolean {
  if (!schedule.minutes.has(at.getUTCMinutes())) return false;
  if (!schedule.hours.has(at.getUTCHours())) return false;
  if (!schedule.months.has(at.getUTCMonth() + 1)) return false;
  const day = schedule.days.has(at.getUTCDate());
  const weekday = schedule.weekdays.has(at.getUTCDay());
  return schedule.dayEither ? day || weekday : day && weekday;
}

/**
 * The next times this runs after `from`, up to `count` of them, looking no
 * further ahead than `withinDays`. Steps a day at a time when the day cannot
 * match, so a monthly timetable is found without walking every minute.
 */
export function nextRuns(
  schedule: Schedule,
  from: Date,
  count = 1,
  withinDays = 400,
): Date[] {
  const out: Date[] = [];
  const at = new Date(from.getTime());
  at.setUTCSeconds(0, 0);
  at.setUTCMinutes(at.getUTCMinutes() + 1);
  const end = from.getTime() + withinDays * 86_400_000;

  while (at.getTime() <= end && out.length < count) {
    const dayOk =
      schedule.months.has(at.getUTCMonth() + 1) &&
      (schedule.dayEither
        ? schedule.days.has(at.getUTCDate()) || schedule.weekdays.has(at.getUTCDay())
        : schedule.days.has(at.getUTCDate()) && schedule.weekdays.has(at.getUTCDay()));
    if (!dayOk) {
      at.setUTCDate(at.getUTCDate() + 1);
      at.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!schedule.hours.has(at.getUTCHours())) {
      at.setUTCHours(at.getUTCHours() + 1, 0, 0, 0);
      continue;
    }
    if (matches(schedule, at)) out.push(new Date(at.getTime()));
    at.setUTCMinutes(at.getUTCMinutes() + 1);
  }
  return out;
}

/**
 * The shortest time between two runs, in minutes, over the coming year.
 *
 * The number a run's timeout is held under: a run that cannot outlast the gap
 * before the next one cannot overlap it, which keeps jobs from running twice at
 * once without Cira having to be the thing that starts them.
 */
export function shortestGapMinutes(schedule: Schedule, from: Date): number {
  const runs = nextRuns(schedule, from, 1500, 370);
  let gap = Number.POSITIVE_INFINITY;
  for (let i = 1; i < runs.length; i += 1) {
    gap = Math.min(gap, (runs[i]!.getTime() - runs[i - 1]!.getTime()) / 60_000);
  }
  return gap;
}

/** A timetable in words, with its zone named, for a page. */
export function describeSchedule(schedule: Schedule): string {
  const [m, h, dom, mon, dow] = schedule.expression.split(" ") as [
    string,
    string,
    string,
    string,
    string,
  ];
  const every = /^\*\/(\d+)$/;
  const single = /^\d+$/;
  const time = () =>
    `${String(Number(h)).padStart(2, "0")}:${String(Number(m)).padStart(2, "0")} UTC`;

  if (dom === "*" && mon === "*" && dow === "*") {
    if (m === "*" && h === "*") return "Every minute";
    const everyMinutes = every.exec(m);
    if (everyMinutes !== null && h === "*") return `Every ${everyMinutes[1]} minutes`;
    if (single.test(m) && h === "*") return `Every hour at :${m.padStart(2, "0")}`;
    const everyHours = every.exec(h);
    if (single.test(m) && everyHours !== null)
      return `Every ${everyHours[1]} hours at :${m.padStart(2, "0")}`;
    if (single.test(m) && single.test(h)) return `Every day at ${time()}`;
  }
  if (single.test(m) && single.test(h) && dom === "*" && mon === "*") {
    const days = [...schedule.weekdays].sort((a, b) => a - b);
    const names = [
      "Sundays",
      "Mondays",
      "Tuesdays",
      "Wednesdays",
      "Thursdays",
      "Fridays",
      "Saturdays",
    ];
    if (days.join(",") === "1,2,3,4,5") return `Weekdays at ${time()}`;
    if (days.length === 1) return `${names[days[0]!]} at ${time()}`;
  }
  if (
    single.test(m) &&
    single.test(h) &&
    single.test(dom) &&
    mon === "*" &&
    dow === "*"
  ) {
    return `On day ${dom} of every month at ${time()}`;
  }
  return `${schedule.expression} (UTC)`;
}
