import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, checkProcessOn } from "./limits.js";
import {
  checkTimetable,
  mergeDeclarations,
  processName,
  readFlyToml,
  readProcfile,
  readScheduledWorkflow,
} from "./processes.js";

/** Wave's own fly.toml, trimmed to the parts that decide anything. */
const WAVE_FLY = `
app = "wav3-api"
primary_region = "ord"

[build]
  dockerfile = "../apps/api/Dockerfile"

[processes]
  api = "uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips '*'"
  worker = "arq app.workers.settings.WorkerSettings"

[deploy]
  release_command = "alembic -c alembic.ini upgrade head"

[http_service]
  internal_port = 8000
  processes = ["api"] # the worker takes no traffic

  [[http_service.checks]]
    method = "GET"
    path = "/readyz"

[[vm]]
  memory = "1024mb"
  processes = ["worker"]
`;

describe("readFlyToml", () => {
  it("finds Wave's worker, and knows the api is its web process", () => {
    expect(readFlyToml(WAVE_FLY)).toEqual({
      web: true,
      dockerfile: "../apps/api/Dockerfile",
      processes: [
        {
          name: "worker",
          kind: "worker",
          command: "arq app.workers.settings.WorkerSettings",
          schedule: null,
          source: "fly.toml",
        },
      ],
    });
  });

  it("reads an app with no process groups as its one web process", () => {
    expect(
      readFlyToml('app = "x"\n[http_service]\n  internal_port = 8080\n'),
    ).toMatchObject({
      web: true,
      processes: [],
    });
  });

  it("reads processes with no web traffic as an app with no web process", () => {
    const parsed = readFlyToml('[processes]\n  worker = "python worker.py"\n');
    expect(parsed.web).toBe(false);
    expect(parsed.processes.map((p) => p.name)).toEqual(["worker"]);
  });
});

describe("readProcfile", () => {
  it("takes web as the app and every other line as a worker", () => {
    expect(
      readProcfile(
        [
          "web: gunicorn app:app",
          "# comment",
          "worker: celery -A tasks worker",
          "clock: python clock.py",
          "release: python manage.py migrate",
          "",
        ].join("\n"),
      ),
    ).toEqual({
      web: true,
      processes: [
        {
          name: "worker",
          kind: "worker",
          command: "celery -A tasks worker",
          schedule: null,
          source: "Procfile",
        },
        {
          name: "clock",
          kind: "worker",
          command: "python clock.py",
          schedule: null,
          source: "Procfile",
        },
      ],
    });
  });

  it("says there is no web process when the Procfile names none", () => {
    expect(readProcfile("worker: node worker.js\n").web).toBe(false);
  });
});

describe("readScheduledWorkflow", () => {
  const workflow = `
name: Weekly report
on:
  schedule:
    - cron: "0 9 * * 1"   # Mondays
  workflow_dispatch:
jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pip install -r requirements.txt
      - run: python scripts/weekly_report.py
`;

  it("takes the timetable and the script it runs", () => {
    expect(readScheduledWorkflow("weekly-report.yml", workflow)).toEqual({
      name: "weekly-report",
      kind: "scheduled",
      command: "python scripts/weekly_report.py",
      schedule: "0 9 * * 1",
      source: "GitHub Actions",
    });
  });

  it("proposes nothing for a workflow that is not scheduled or runs no script", () => {
    expect(readScheduledWorkflow("ci.yml", "on:\n  push:\njobs: {}\n")).toBeNull();
    expect(
      readScheduledWorkflow(
        "cleanup.yml",
        'on:\n  schedule:\n    - cron: "0 0 * * *"\njobs:\n  x:\n    steps:\n      - uses: actions/stale@v9\n',
      ),
    ).toBeNull();
  });

  it("ignores a timetable it could not run", () => {
    expect(
      readScheduledWorkflow(
        "odd.yml",
        'on:\n  schedule:\n    - cron: "0 0 L * *"\njobs:\n  x:\n    steps:\n      - run: node job.js\n',
      ),
    ).toBeNull();
  });
});

describe("processName", () => {
  it("makes a name Google accepts and a person can read", () => {
    expect(processName("Weekly_Report")).toBe("weekly-report");
    expect(processName("2am-sync")).toBe("p-2am-sync");
    expect(processName("***")).toBe("process");
    expect(processName("a".repeat(50))).toHaveLength(30);
  });
});

describe("mergeDeclarations", () => {
  it("keeps one of each name, believing the more specific file", () => {
    const merged = mergeDeclarations([
      readProcfile("worker: python a.py\n"),
      readFlyToml('[processes]\n  worker = "python b.py"\n  jobs = "python c.py"\n'),
    ]);
    expect(merged.processes.map((p) => [p.name, p.command])).toEqual([
      ["worker", "python a.py"],
      ["jobs", "python c.py"],
    ]);
    expect(merged.web).toBe(false);
  });

  it("is a web app if any file says so", () => {
    expect(
      mergeDeclarations([readProcfile("worker: x.py\n"), readProcfile("web: y\n")]).web,
    ).toBe(true);
    expect(mergeDeclarations([]).web).toBeNull();
  });
});

describe("checkTimetable", () => {
  const now = new Date("2026-09-19T12:00:00Z");

  it("accepts a timetable and keeps each run shorter than the gap to the next", () => {
    const weekly = checkTimetable("0 9 * * 1", null, DEFAULT_LIMITS, now);
    expect(weekly).toMatchObject({
      ok: true,
      words: "Mondays at 09:00 UTC",
      timeoutMinutes: DEFAULT_LIMITS.processes.defaultTimeoutMinutes,
    });

    // Every five minutes leaves room for four, whatever was asked for.
    const tight = checkTimetable("*/5 * * * *", 30, DEFAULT_LIMITS, now);
    expect(tight).toMatchObject({ ok: true, timeoutMinutes: 4, gapMinutes: 5 });
  });

  it("refuses what it cannot run, and says what to do instead", () => {
    const often = checkTimetable("* * * * *", null, DEFAULT_LIMITS, now);
    expect(!often.ok && often.message).toContain("belongs in a worker");

    const long = checkTimetable("0 9 * * 1", 90, DEFAULT_LIMITS, now);
    expect(!long.ok && long.message).toContain("between 1 and 60 minutes");

    const bad = checkTimetable("sometimes", null, DEFAULT_LIMITS, now);
    expect(bad.ok).toBe(false);
  });
});

describe("checkProcessOn", () => {
  it("counts workers and scheduled runs separately, with their own limits", () => {
    const { workersPerSpace, scheduledPerSpace } = DEFAULT_LIMITS.processes;
    expect(checkProcessOn("worker", workersPerSpace - 1, DEFAULT_LIMITS).ok).toBe(true);
    const full = checkProcessOn("worker", workersPerSpace, DEFAULT_LIMITS);
    expect(!full.ok && full.message).toContain("Workers run all the time");
    expect(checkProcessOn("scheduled", workersPerSpace, DEFAULT_LIMITS).ok).toBe(
      workersPerSpace < scheduledPerSpace,
    );
  });
});
