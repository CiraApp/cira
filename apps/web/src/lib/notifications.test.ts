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
      crashes: null,
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

    // And the app is still what it was: live, on the build before.
    const { apps } = await import("@cira/db");
    const [after] = await database.select().from(apps).where(eq(apps.id, appId));
    expect(after?.status).toBe("live");
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
    expect(sent[0]?.subject).toBe("Reports: \u201cweekly-report\u201d failed");
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
      "Reports: its worker keeps stopping",
      "Reports: its worker keeps stopping",
    ]);
    expect(sent[0]?.text).toContain("running out of memory");
  });

  // Measured on production: the pool calls itself ready throughout, and the
  // only trace of a worker exiting every few seconds is Google's exit line.
  it("tells them when a worker keeps exiting, with its exit code", async () => {
    const { watchEverything } = await import("./watch");
    // Well after any earlier test's trouble, and seen well first.
    await watchEverything(new Date("2026-09-24T10:00:00Z"));
    sent.length = 0;
    const now = new Date("2026-09-24T11:00:00Z");
    states = [
      {
        ...healthy()[0]!,
        crashes: {
          count: 12,
          more: false,
          lastAt: new Date("2026-09-24T10:59:30Z"),
          exitCode: 3,
        },
      } as ProcessState,
      healthy()[1]!,
    ];
    await watchEverything(now);
    expect(sent.map((e) => e.subject)).toEqual([
      "Reports: its worker keeps stopping",
      "Reports: its worker keeps stopping",
    ]);
    expect(sent[0]?.text).toContain("exited 12 times in the last hour, with code 3");
  });

  it("records an event it could not send, and sends it once the provider is back", async () => {
    const { notifications } = await import("@cira/db");
    const { notifyManagers, retryUnsent } = await import("./notify");
    const { refusedMessage } = await import("./messages");
    emailOutcome = { sent: false, reason: "unreachable" };
    const compose = (app: Parameters<typeof refusedMessage>[0]["app"]) =>
      refusedMessage({ app, operation: "Export", told: false });
    expect(
      await notifyManagers({ appId, kind: "capability-refused", subject: "x", compose }),
    ).toBe("not-sent");
    // Noticed again: still one event, never a second email about it.
    expect(
      await notifyManagers({ appId, kind: "capability-refused", subject: "x", compose }),
    ).toBe("already-told");
    const [waiting] = await database
      .select()
      .from(notifications)
      .where(eq(notifications.subject, "x"));
    expect(waiting).toMatchObject({
      recipients: 0,
      sentAt: null,
      failure: "The email provider could not be reached.",
    });
    expect([...(waiting?.unsent ?? [])].sort()).toEqual(managers);

    // It used to be lost for good here. The watcher now tries again.
    emailOutcome = { sent: true };
    expect(await retryUnsent()).toBe(1);
    expect(recipients()).toEqual(managers);
    const [done] = await database
      .select()
      .from(notifications)
      .where(eq(notifications.subject, "x"));
    expect(done).toMatchObject({ recipients: 2, unsent: [], failure: null });
    expect(done?.sentAt).not.toBeNull();
    expect(await retryUnsent()).toBe(0);
  });

  it("holds a flapping app to two outage emails in two hours", async () => {
    const { notifyManagers } = await import("./notify");
    const { notAnsweringMessage } = await import("./messages");
    const flap = (n: number) =>
      notifyManagers({
        appId,
        kind: "app-down",
        subject: `flap@${n}`,
        topic: "flap",
        compose: (app) =>
          notAnsweringMessage({
            app,
            worker: null,
            since: new Date(),
            why: null,
            logs: "",
          }),
      });
    expect(await flap(1)).toBe("sent");
    expect(await flap(2)).toBe("sent");
    expect(await flap(3)).toBe("held-back");
    expect(await flap(4)).toBe("held-back");
    expect(sent).toHaveLength(4); // two outages, two managers each

    // Back up after an outage nobody was told about is not news either.
    const { answeringAgainMessage } = await import("./messages");
    expect(
      await notifyManagers({
        appId,
        kind: "app-back",
        subject: "flap@3",
        topic: "flap",
        compose: (app) =>
          answeringAgainMessage({
            app,
            worker: null,
            since: new Date(),
            now: new Date(),
          }),
      }),
    ).toBe("held-back");
  });

  it("never writes to one of the demo company's invented people", async () => {
    const { memberships, users } = await import("@cira/db");
    const { notifyAdmins } = await import("./notify");
    const { paymentFailedMessage } = await import("./messages");
    await database.insert(users).values({
      id: "usr_demo_ada",
      externalId: "demo_ada",
      name: "Ada",
      email: "ada@halcyon.dev",
    });
    await database.insert(memberships).values({
      id: "mem_demo_ada",
      userId: "usr_demo_ada",
      spaceId,
      role: "admin",
    });
    await notifyAdmins({
      spaceId,
      kind: "payment-failed",
      subject: "in_1",
      compose: (space) => paymentFailedMessage({ space }),
    });
    expect(recipients()).toEqual(["admin@acme.test"]);
  });

  it("tells a space's admins about the space once", async () => {
    const { notifyAdmins } = await import("./notify");
    const { trialEndingMessage } = await import("./messages");
    const once = () =>
      notifyAdmins({
        spaceId,
        kind: "trial-ending",
        subject: "2026-10-01",
        compose: (space) =>
          trialEndingMessage({ space, endsAt: new Date("2026-10-01T00:00:00Z") }),
      });
    expect(await once()).toBe("sent");
    expect(await once()).toBe("already-told");
    // Admins and owners only: the app's own owner here is a plain member.
    expect(recipients()).toEqual(["admin@acme.test"]);
    expect(sent[0]?.subject).toBe("Acme's Cira trial ends Thursday, Oct 1");
  });
});
