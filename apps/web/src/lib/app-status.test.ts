import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  newId,
  type ProcessState,
  type RuntimeLogEntry,
  type RuntimeLogQuery,
  type User,
} from "@cira/core";
import type * as CiraDb from "@cira/db";
import type * as CiraDeploy from "@cira/deploy";
import { migratedTestDatabase } from "../../../../packages/db/src/test-database.js";
import { matchApps } from "./app-status";

/**
 * Checking on an app's workers and scheduled runs from Ask Cira or an agent:
 * who sees what, and which app "the report thing" turns out to be.
 */

describe("matchApps", () => {
  const shelf = [
    { app: { name: "Weekly Reports", slug: "weekly-reports" } },
    { app: { name: "Background App", slug: "background-app" } },
    { app: { name: "Revenue Dashboard", slug: "revenue-dashboard" } },
    { app: { name: "Revenue Forecast", slug: "forecast" } },
  ];
  const names = (found: typeof shelf) => found.map((f) => f.app.name);

  it("takes an exact name or slug, whatever its case and punctuation", () => {
    expect(names(matchApps(shelf, "weekly reports"))).toEqual(["Weekly Reports"]);
    expect(names(matchApps(shelf, "background-app"))).toEqual(["Background App"]);
    expect(names(matchApps(shelf, "FORECAST"))).toEqual(["Revenue Forecast"]);
  });

  it("finds a name inside what was said, and what was said inside a name", () => {
    expect(names(matchApps(shelf, "is the background app worker ok"))).toEqual([
      "Background App",
    ]);
    expect(names(matchApps(shelf, "dashboard"))).toEqual(["Revenue Dashboard"]);
  });

  it("falls back to shared words, ignoring the ones any app could carry", () => {
    expect(names(matchApps(shelf, "our weekly report job"))).toEqual(["Weekly Reports"]);
    // "worker" and "background" say nothing about which app is meant.
    expect(matchApps(shelf, "our background worker")).toEqual([]);
  });

  it("returns every app that fits equally, so the person can be asked", () => {
    expect(names(matchApps(shelf, "revenue numbers"))).toEqual([
      "Revenue Dashboard",
      "Revenue Forecast",
    ]);
    expect(matchApps(shelf, "  ")).toEqual([]);
  });
});

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];
const hasDatabase = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== "";

let database: Awaited<ReturnType<typeof migratedTestDatabase>>;

vi.mock("@cira/db", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDb>();
  return { ...actual, db: () => database };
});

/** What the logs were asked for, and whether Google can be reached at all. */
const logReads: RuntimeLogQuery[] = [];
let googleDown = false;

const lastRun = {
  id: "report-abc12",
  startedAt: new Date("2026-09-18T09:00:04Z"),
  finishedAt: new Date("2026-09-18T09:01:50Z"),
  outcome: "failed" as const,
  outOfMemory: false,
};

vi.mock("@cira/deploy", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDeploy>();
  return {
    ...actual,
    deploymentProvider: () => ({
      getStatus: () => Promise.resolve({ status: "live", url: null }),
      processStates: (): Promise<ProcessState[]> =>
        googleDown
          ? Promise.reject(new Error("unreachable"))
          : Promise.resolve([
              {
                kind: "worker",
                name: "worker",
                instances: 1,
                health: "ready",
                memoryMiB: 1024,
                outOfMemoryAt: null,
              },
              {
                kind: "scheduled",
                name: "report",
                exists: true,
                memoryMiB: 1024,
                runs: [
                  lastRun,
                  {
                    id: "report-abc11",
                    startedAt: new Date("2026-09-17T09:00:03Z"),
                    finishedAt: new Date("2026-09-17T09:00:50Z"),
                    outcome: "succeeded",
                    outOfMemory: false,
                  },
                ],
              },
            ]),
      getRuntimeLogs: (_handle: string, query: RuntimeLogQuery) => {
        logReads.push(query);
        const entry = (at: string, message: string): RuntimeLogEntry => ({
          id: at,
          timestamp: new Date(at),
          level: "info",
          message,
          truncated: false,
          request: null,
          container: null,
          detail: "{}",
        });
        // Newest first, as the provider answers.
        return Promise.resolve({
          entries: [
            entry("2026-09-19T10:00:02Z", `second line from ${query.process?.name}`),
            entry("2026-09-19T10:00:01Z", `first line from ${query.process?.name}`),
          ],
          nextPageToken: null,
        });
      },
    }),
  };
});

const person = (name: string): User => ({
  id: newId("user"),
  name,
  email: `${name.toLowerCase()}@s.test`,
  createdAt: new Date(),
});
const owner = person("Owner");
const colleague = person("Colleague");
const outsider = person("Outsider");
const spaceId = newId("space");
const appId = newId("app");
const ORIGIN = "https://cira.test";

describe.skipIf(!hasDatabase)("app status", () => {
  beforeAll(async () => {
    database = await migratedTestDatabase(TEST_DATABASE_URL as string, "cira_status");
    const { appAccess, apps, deployments, memberships, processes, spaces, users } =
      await import("@cira/db");
    await database.insert(users).values(
      [owner, colleague, outsider].map((u, i) => ({
        id: u.id,
        externalId: `s${i}`,
        name: u.name,
        email: u.email,
      })),
    );
    await database
      .insert(spaces)
      .values({ id: spaceId, name: "Status Co", slug: "status-co", domain: "s.test" });
    await database.insert(memberships).values(
      [owner, colleague, outsider].map((u) => ({
        id: newId("membership"),
        userId: u.id,
        spaceId,
        role: "member" as const,
      })),
    );
    const handbookId = newId("app");
    await database.insert(apps).values([
      {
        id: appId,
        spaceId,
        name: "Weekly Reports",
        slug: "weekly-reports",
        status: "live",
        ownerUserId: owner.id,
      },
      {
        id: handbookId,
        spaceId,
        name: "Handbook",
        slug: "handbook",
        status: "live",
        ownerUserId: owner.id,
      },
    ]);
    await database.insert(appAccess).values([
      { id: newId("access"), appId, type: "user", targetId: colleague.id },
      { id: newId("access"), appId: handbookId, type: "space", targetId: spaceId },
    ]);
    await database.insert(deployments).values({
      id: newId("deployment"),
      appId,
      provider: "cloudrun",
      providerDeploymentId: "b1:status-co-weekly-reports:t1:noweb",
      status: "live",
      servesWeb: false,
    });
    await database.insert(processes).values([
      {
        id: newId("process"),
        appId,
        spaceId,
        name: "worker",
        kind: "worker",
        command: "python worker.py --token-from-env",
        serviceSlug: "app",
        schedule: null,
        enabled: true,
        source: "Procfile",
      },
      {
        id: newId("process"),
        appId,
        spaceId,
        name: "report",
        kind: "scheduled",
        command: "python report.py",
        serviceSlug: "app",
        schedule: "0 9 * * 1-5",
        enabled: true,
        source: "GitHub Actions",
      },
    ]);
  }, 60_000);

  afterAll(async () => {
    await database?.end();
  });

  beforeEach(() => {
    logReads.length = 0;
    googleDown = false;
  });

  const statusFor = async (user: User, query: string) => {
    const { appStatusForUser } = await import("./app-status");
    return appStatusForUser(user, query, ORIGIN);
  };

  it("tells anyone who can open the app how its work is going, without how it runs", async () => {
    const result = await statusFor(colleague, "the weekly report");
    expect(result.ok).toBe(true);
    const data = result.ok ? result.data : {};

    expect(data).toMatchObject({
      app: "Weekly Reports",
      appId,
      deployment: "live",
      managedBy: "Owner",
      page: `${ORIGIN}/status-co/weekly-reports`,
    });
    expect(data).not.toHaveProperty("logs");

    const [worker, report] = data["processes"] as Array<Record<string, unknown>>;
    expect(worker).toEqual({
      name: "worker",
      kind: "worker",
      switchedOn: true,
      memory: "1 GB",
      state: "running",
    });
    expect(report).toMatchObject({
      name: "report",
      state: "on",
      timetable: expect.stringContaining("09:00") as unknown,
      nextRunAt: expect.any(String) as unknown,
      recentRuns: [
        { startedAt: "2026-09-18T09:00:04.000Z", outcome: "failed", took: "1m 46s" },
        { startedAt: "2026-09-17T09:00:03.000Z", outcome: "succeeded", took: "47s" },
      ],
    });
    expect(report).not.toHaveProperty("command");
    expect(report).not.toHaveProperty("lastRunLogs");
    expect(JSON.stringify(data)).not.toContain("--token-from-env");
    expect(logReads).toHaveLength(0);
  });

  it("gives the app's managers its commands and what it logged", async () => {
    const result = await statusFor(owner, "weekly-reports");
    const data = result.ok ? result.data : {};
    expect(data["logs"]).toBe(`${ORIGIN}/status-co/weekly-reports/logs`);

    const [worker, report] = data["processes"] as Array<Record<string, unknown>>;
    expect(worker).toMatchObject({
      command: "python worker.py --token-from-env",
      recentLogs: [
        "2026-09-19T10:00:01.000Z info first line from worker",
        "2026-09-19T10:00:02.000Z info second line from worker",
      ],
    });
    // The failed run's own lines, read around when it ran.
    expect(report).toMatchObject({
      command: "python report.py",
      lastRunLogs: expect.arrayContaining([
        "2026-09-19T10:00:01.000Z info first line from report",
      ]) as unknown,
    });
    const reportRead = logReads.find((q) => q.process?.name === "report");
    expect(reportRead?.since.getTime()).toBeLessThan(lastRun.startedAt.getTime());
    expect(reportRead?.until.getTime()).toBeGreaterThan(lastRun.finishedAt.getTime());
  });

  it("says it could not check, rather than guessing, when Google cannot be reached", async () => {
    googleDown = true;
    const result = await statusFor(colleague, "Weekly Reports");
    const [worker, report] = (result.ok ? result.data["processes"] : []) as Array<
      Record<string, unknown>
    >;
    expect(worker?.["state"]).toContain("could not reach Google Cloud");
    expect(report?.["runs"]).toContain("could not reach Google Cloud");
  });

  it("never names an app to someone who cannot open it", async () => {
    const result = await statusFor(outsider, "weekly reports");
    expect(result.ok).toBe(true);
    const text = JSON.stringify(result.ok ? result.data : {});
    expect(text).not.toContain("Weekly Reports");
    expect(text).toContain("Handbook");
    expect(logReads).toHaveLength(0);
  });

  it("lists the apps to choose from when nothing is named", async () => {
    const result = await statusFor(colleague, "");
    expect(result.ok && result.data).toEqual({
      apps: [
        { app: "Handbook", workers: 0, scheduledRuns: 0 },
        { app: "Weekly Reports", workers: 1, scheduledRuns: 1 },
      ],
    });
  });

  it("is what the agent surface returns for app_status", async () => {
    const { runTool } = await import("./mcp");
    const outcome = await runTool(
      colleague,
      "app_status",
      { app: "Weekly Reports" },
      { via: "ask", origin: ORIGIN },
    );
    expect(outcome.isError).toBe(false);
    expect(JSON.parse(outcome.content)).toMatchObject({ app: "Weekly Reports" });
  });
});
