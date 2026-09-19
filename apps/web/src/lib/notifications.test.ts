import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { newId, type Deployment, type ProcessState, type User } from "@cira/core";
import type * as CiraDb from "@cira/db";
import type * as CiraDeploy from "@cira/deploy";
import type * as EmailModule from "./email";
import type { Email, EmailOutcome } from "./email";
import { migratedTestDatabase } from "../../../../packages/db/src/test-database.js";

/**
 * The four things the people who manage an app are told about - a deploy that
 * failed, an app or worker that stopped answering, a scheduled run that
 * failed, a capability that stopped letting Cira in - followed from where
 * each is noticed to the email, with Google and the email provider replaced.
 */

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];
const hasDatabase = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== "";

let database: Awaited<ReturnType<typeof migratedTestDatabase>>;

vi.mock("@cira/db", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDb>();
  return { ...actual, db: () => database };
});

/** Every email "sent", and whether the provider is taking any. */
const sent: Email[] = [];
let emailOutcome: EmailOutcome = { sent: true };
vi.mock("./email", async (importOriginal) => {
  const actual = await importOriginal<typeof EmailModule>();
  return {
    ...actual,
    sendEmail: (email: Email) => {
      if (emailOutcome.sent) sent.push(email);
      return Promise.resolve(emailOutcome);
    },
  };
});

/** What Google says about the app's processes, and whether its address answers. */
let states: ProcessState[] = [];
let appAnswers = 200;
vi.mock("@cira/deploy", async (importOriginal) => {
  const actual = await importOriginal<typeof CiraDeploy>();
  return {
    ...actual,
    deploymentProvider: () => ({
      getStatus: () => Promise.resolve({ status: "failed", url: null }),
      invocationToken: () => Promise.resolve("id-token"),
      processStates: () => Promise.resolve(states),
    }),
  };
});

const person = (name: string): User => ({
  id: newId("user"),
  name,
  email: `${name.toLowerCase()}@acme.test`,
  createdAt: new Date(),
});
const owner = person("Owner");
const admin = person("Admin");
const member = person("Member");
const spaceId = newId("space");
const appId = newId("app");
const liveId = newId("deployment");
const capabilityId = newId("capability");

describe.skipIf(!hasDatabase)("notifications", () => {
  beforeAll(async () => {
    database = await migratedTestDatabase(TEST_DATABASE_URL as string, "cira_notify");
    const { apps, capabilities, deployments, memberships, processes, spaces, users } =
      await import("@cira/db");
    await database.insert(users).values(
      [owner, admin, member].map((u, i) => ({
        id: u.id,
        externalId: `n${i}`,
        name: u.name,
        email: u.email,
      })),
    );
    await database
      .insert(spaces)
      .values({ id: spaceId, name: "Acme", slug: "acme", domain: "acme.test" });
    await database.insert(memberships).values([
      { id: newId("membership"), userId: owner.id, spaceId, role: "member" },
      { id: newId("membership"), userId: admin.id, spaceId, role: "admin" },
      { id: newId("membership"), userId: member.id, spaceId, role: "member" },
    ]);
    await database.insert(apps).values({
      id: appId,
      spaceId,
      name: "Reports",
      slug: "reports",
      status: "live",
      ownerUserId: owner.id,
    });
    await database.insert(deployments).values({
      id: liveId,
      appId,
      provider: "cloudrun",
      providerDeploymentId: "b1:acme-reports:t1",
      status: "live",
      url: "https://acme-reports.a.run.app",
      createdAt: new Date(Date.now() - 3600_000),
    });
    await database.insert(capabilities).values({
      id: capabilityId,
      spaceId,
      appId,
      name: "createRefund",
      description: "Refund an invoice.",
      inputSchema: { type: "object" },
      method: "POST",
      path: "/refunds",
      risk: "write",
      enabled: true,
      reach: "callable",
      answeredBy: liveId,
    });
    await database.insert(processes).values([
      {
        id: newId("process"),
        appId,
        spaceId,
        name: "worker",
        kind: "worker",
        command: "python worker.py",
        serviceSlug: "app",
        enabled: true,
        source: "Procfile",
      },
      {
        id: newId("process"),
        appId,
        spaceId,
        name: "weekly-report",
        kind: "scheduled",
        command: "python report.py",
        serviceSlug: "app",
        schedule: "0 9 * * 1",
        enabled: true,
        source: "GitHub Actions",
      },
    ]);

    vi.stubGlobal("fetch", async () => new Response("", { status: appAnswers }));
  }, 60_000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    await database?.end();
  });

  const healthy = (): ProcessState[] => [
    {
      kind: "worker",
      name: "worker",
      instances: 1,
      health: "ready",
      memoryMiB: 1024,
      outOfMemoryAt: null,
    },
    { kind: "scheduled", name: "weekly-report", exists: true, memoryMiB: 1024, runs: [] },
  ];

  beforeEach(() => {
    sent.length = 0;
    emailOutcome = { sent: true };
    appAnswers = 200;
    states = healthy();
  });

  const recipients = () => sent.map((e) => e.to).sort();
  const managers = ["admin@acme.test", "owner@acme.test"];

  it("tells the app's managers, and only them, once, when a deploy fails", async () => {
    const { deployments } = await import("@cira/db");
    const { recordDeploymentStatus } = await import("./deployment-sync");
    const id = newId("deployment");
    await database.insert(deployments).values({
      id,
      appId,
      provider: "cloudrun",
      providerDeploymentId: "b2:acme-reports:t2",
      status: "building",
    });
    const [row] = await database.select().from(deployments).where(eq(deployments.id, id));

    // The CLI polling and someone opening the page, at the same moment.
    await Promise.all([
      recordDeploymentStatus(row as Deployment, { status: "failed", url: null }),
      recordDeploymentStatus(row as Deployment, { status: "failed", url: null }),
    ]);

    expect(recipients()).toEqual(managers);
    expect(sent[0]?.subject).toBe("Reports: a deploy failed");
    expect(sent[0]?.text).toContain("still running");
    expect(sent[0]?.text).toContain("https://cira.dev/acme/reports");
  });

  it("tells them once when a capability that worked stops letting Cira in", async () => {
    const { recordRefusal } = await import("./capabilities");
    await recordRefusal({ capabilityId, deploymentId: liveId });
    await recordRefusal({ capabilityId, deploymentId: liveId });
    expect(recipients()).toEqual(managers);
    expect(sent[0]?.subject).toBe("Reports: Create refund stopped letting Cira in");
  });

  it("tells them when the app stops answering, and when it is back", async () => {
    const { watchEverything } = await import("./watch");
    appAnswers = 503;
    await watchEverything(new Date("2026-09-19T12:00:00Z"));
    expect(sent).toHaveLength(0);
    await watchEverything(new Date("2026-09-19T12:05:00Z"));
    expect(sent.map((e) => e.subject)).toEqual([
      "Reports is not answering",
      "Reports is not answering",
    ]);
    expect(sent[0]?.text).toContain("since Sat, Sep 19, 12:00 UTC");
    await watchEverything(new Date("2026-09-19T12:10:00Z"));
    expect(sent).toHaveLength(2);

    appAnswers = 404;
    await watchEverything(new Date("2026-09-19T12:15:00Z"));
    expect(sent.slice(2).map((e) => e.subject)).toEqual([
      "Reports is answering again",
      "Reports is answering again",
    ]);
  });

  it("tells them about a failed scheduled run once, and not about an old one", async () => {
    const { watchEverything } = await import("./watch");
    const now = new Date("2026-09-21T09:30:00Z");
    states = [
      healthy()[0]!,
      {
        kind: "scheduled",
        name: "weekly-report",
        exists: true,
        memoryMiB: 1024,
        runs: [
          {
            id: "weekly-report-new",
            startedAt: new Date("2026-09-21T09:00:00Z"),
            finishedAt: new Date("2026-09-21T09:02:00Z"),
            outcome: "failed",
            outOfMemory: true,
          },
          {
            id: "weekly-report-old",
            startedAt: new Date("2026-09-14T09:00:00Z"),
            finishedAt: new Date("2026-09-14T09:02:00Z"),
            outcome: "failed",
            outOfMemory: false,
          },
        ],
      },
    ];
    await watchEverything(now);
    await watchEverything(new Date(now.getTime() + 5 * 60_000));
    expect(recipients()).toEqual(managers);
    expect(sent[0]?.subject).toBe("Reports: weekly-report failed");
    expect(sent[0]?.text).toContain("because it ran out of memory");
  });

  it("tells them when a worker keeps running out of memory", async () => {
    const { watchEverything } = await import("./watch");
    const now = new Date("2026-09-22T10:00:00Z");
    states = [
      {
        ...healthy()[0]!,
        outOfMemoryAt: new Date("2026-09-22T09:58:00Z"),
      } as ProcessState,
      healthy()[1]!,
    ];
    await watchEverything(now);
    expect(sent.map((e) => e.subject)).toEqual([
      "Reports: the worker worker keeps stopping",
      "Reports: the worker worker keeps stopping",
    ]);
    expect(sent[0]?.text).toContain("running out of memory");
  });

  it("records an event it could not send, and does not send it later", async () => {
    const { notifications } = await import("@cira/db");
    const { notifyManagers } = await import("./notify");
    const { refusedMessage } = await import("./messages");
    emailOutcome = { sent: false, reason: "not-configured" };
    const compose = (app: Parameters<typeof refusedMessage>[0]["app"]) =>
      refusedMessage({ app, operation: "Export" });
    expect(
      await notifyManagers({ appId, kind: "capability-refused", subject: "x", compose }),
    ).toBe("not-sent");
    emailOutcome = { sent: true };
    expect(
      await notifyManagers({ appId, kind: "capability-refused", subject: "x", compose }),
    ).toBe("already-told");
    const [row] = await database
      .select()
      .from(notifications)
      .where(eq(notifications.subject, "x"));
    expect(row).toMatchObject({
      recipients: 0,
      sentAt: null,
      failure: "Email is not configured for this Cira.",
    });
  });
});
