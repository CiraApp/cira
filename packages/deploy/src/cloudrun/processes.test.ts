import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDeploymentInput, ProcessSpec } from "@cira/core";
import type { GoogleTokens } from "./auth.js";
import type { CloudRunConfig } from "./config.js";
import { CloudRunProvider } from "./provider.js";
import { startCommand } from "./processes.js";
import { imageTag } from "./source.js";

/**
 * Workers and scheduled runs, followed through Google.
 *
 * Google is replaced by a small in-memory version of the four APIs involved -
 * Cloud Run jobs, worker pools, executions, and Cloud Scheduler - that keeps
 * what it is told, so each flow can be followed from deploy to run as state
 * rather than as a list of requests.
 */

const config = {
  projectId: "proj",
  projectNumber: "1",
  region: "us-central1",
  sourceBucket: "cira-sources",
  artifactRepo: "cira-apps",
  serviceAccountEmail: "deployer@proj.iam.gserviceaccount.com",
  poolId: "vercel",
  providerId: "vercel",
} satisfies CloudRunConfig;

const tokens = {
  accessToken: async () => "ya29.fake",
  identityToken: async (audience: string) => `id-for-${audience}`,
} as unknown as GoogleTokens;

const SOURCE_URI = "gs://cira-sources/sources/usr_1/src_2.tar.gz#17000001";
const TAG = imageTag(SOURCE_URI);
const SERVICE = "acme-sync-0000app1";

type Doc = Record<string, unknown> & { name?: string; labels?: Record<string, string> };

/** Google, as far as these four APIs go. */
class FakeGoogle {
  jobs = new Map<string, Doc>();
  pools = new Map<string, Doc>();
  schedules = new Map<string, Doc & { state: string }>();
  executions = new Map<string, Doc[]>();
  service: Doc | null = null;
  buildStatus = "SUCCESS";
  builds = 0;
  /** Out-of-memory lines Cloud Run has logged, by worker pool. */
  outOfMemory = new Map<string, string>();
  /** Every job run started, release runs included. */
  runs = 0;
  /** How many resources one page of a listing holds, as Google pages them. */
  pageLimit = Infinity;
  /** Resources Google refuses to change, the way a quota or a policy does. */
  refused = new Set<string>();

  handle(url: string, method: string, body: unknown): Response {
    const u = new URL(url);
    const path = u.pathname;
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), { status });
    const missing = () => json({ error: { status: "NOT_FOUND" } }, 404);

    if (u.host.startsWith("logging")) {
      const filter = String((body as { filter?: unknown }).filter);
      const pool = /worker_pool_name="([^"]+)"/.exec(filter)?.[1] ?? "";
      const at = this.outOfMemory.get(pool);
      return json({
        entries:
          at !== undefined && filter.includes("Out-of-memory event detected")
            ? [{ timestamp: at }]
            : [],
      });
    }

    if (u.host.startsWith("cloudbuild")) {
      // Every build its own id, as Google gives them: a second deploy is a
      // second build, and must not look like the first one finishing again.
      if (method === "POST") {
        this.builds += 1;
        return json({ metadata: { build: { id: `b-${this.builds}` } } });
      }
      return json({ id: path.split("/").pop(), status: this.buildStatus });
    }

    if (u.host.startsWith("cloudscheduler")) {
      const action = /:(pause|resume)$/.exec(path);
      const id =
        path
          .replace(/:(pause|resume)$/, "")
          .split("/")
          .pop() ?? "";
      if (action !== null) {
        const job = this.schedules.get(id);
        if (job === undefined) return missing();
        job.state = action[1] === "pause" ? "PAUSED" : "ENABLED";
        return json(job);
      }
      if (method === "POST") {
        const doc = body as Doc;
        const name = String(doc.name).split("/").pop() ?? "";
        const created = { ...doc, state: "ENABLED" };
        this.schedules.set(name, created);
        return json(created);
      }
      if (method === "GET")
        return this.schedules.has(id) ? json(this.schedules.get(id)) : missing();
      if (method === "PATCH") {
        const existing = this.schedules.get(id);
        if (existing === undefined) return missing();
        this.schedules.set(id, { ...existing, ...(body as Doc), state: existing.state });
        return json(this.schedules.get(id));
      }
      if (method === "DELETE") {
        return this.schedules.delete(id) ? json({}) : missing();
      }
    }

    // Cloud Run.
    if (path.endsWith("/services/" + SERVICE)) {
      if (method === "PATCH") {
        this.service = {
          uri: "https://acme-sync.a.run.app",
          latestReadyRevision: "acme-sync-00001",
          latestCreatedRevision: "acme-sync-00001",
          terminalCondition: { state: "CONDITION_SUCCEEDED" },
          trafficStatuses: [
            { type: "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST", percent: 100 },
          ],
          ...(body as Doc),
        };
        return json({ name: "operations/service" });
      }
      if (method === "DELETE") {
        const had = this.service !== null;
        this.service = null;
        return had ? json({}) : missing();
      }
      return this.service === null ? missing() : json(this.service);
    }
    const kinds: Array<[string, Map<string, Doc>, string]> = [
      ["/jobs", this.jobs, "jobs"],
      ["/workerPools", this.pools, "workerPools"],
    ];
    for (const [segment, store, listKey] of kinds) {
      if (path.endsWith(segment) && method === "GET") {
        const all = [...store.values()];
        const from = Number(u.searchParams.get("pageToken") ?? "0");
        const page = all.slice(from, from + this.pageLimit);
        const next = from + page.length;
        return json({
          [listKey]: page,
          ...(next < all.length ? { nextPageToken: String(next) } : {}),
        });
      }
      const at = path.indexOf(`${segment}/`);
      if (at === -1) continue;
      const rest = path.slice(at + segment.length + 1);
      const [name, sub] = rest.split("/");
      const bare = (name ?? "").replace(/:run$/, "");
      if (sub === "executions") {
        const one = rest.split("/")[2];
        const all = this.executions.get(bare) ?? [];
        if (one === undefined) return json({ executions: all });
        const found = all.find((e) => e.name === one);
        return found === undefined ? missing() : json(found);
      }
      if (name?.endsWith(":run")) {
        if (!store.has(bare)) return missing();
        const list = this.executions.get(bare) ?? [];
        const run = `e-${list.length + 1}`;
        list.unshift({ name: run, createTime: new Date().toISOString() });
        this.executions.set(bare, list);
        this.runs += 1;
        return json({
          name: "operations/run",
          metadata: {
            name: `projects/proj/locations/us-central1/jobs/${bare}/executions/${run}`,
          },
        });
      }
      if (method === "GET") return store.has(bare) ? json(store.get(bare)) : missing();
      if (this.refused.has(bare))
        return json({ error: { status: "FAILED_PRECONDITION" } }, 400);
      if (method === "DELETE") return store.delete(bare) ? json({}) : missing();
      if (method === "PATCH") {
        if (!store.has(bare) && u.searchParams.get("allowMissing") !== "true")
          return missing();
        store.set(bare, {
          ...(body as Doc),
          name: `projects/proj/locations/us-central1${segment}/${bare}`,
        });
        return json({ name: "operations/1" });
      }
    }
    return missing();
  }
}

let google: FakeGoogle;
let calls: Array<{ url: string; method: string; body: unknown }>;

beforeEach(() => {
  google = new FakeGoogle();
  calls = [];
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const raw = init?.body;
    const body = typeof raw === "string" ? JSON.parse(raw) : undefined;
    calls.push({ url: String(input), method: init?.method ?? "GET", body });
    return google.handle(String(input), init?.method ?? "GET", body);
  });
});

const provider = () => new CloudRunProvider(config, tokens);

const report: ProcessSpec = {
  name: "report",
  kind: "scheduled",
  command: "python report.py",
  service: "app",
  schedule: "0 9 * * 1",
  timeoutSeconds: 600,
  memoryMiB: 2048,
  enabled: false,
};
const worker: ProcessSpec = {
  name: "worker",
  kind: "worker",
  command: "python worker.py",
  service: "app",
  schedule: null,
  timeoutSeconds: 600,
  memoryMiB: 1024,
  enabled: false,
};

const scriptApp = (processes: ProcessSpec[]): AppDeploymentInput => ({
  appId: "app_00000000000000000000000000000app1",
  spaceSlug: "acme",
  appSlug: "sync",
  framework: "python",
  source: { uri: SOURCE_URI, size: 1024 },
  services: [
    { slug: "app", sourcePath: "", dockerfile: null, port: null, ingress: false },
  ],
  env: { set: { DATABASE_URL: "postgres://db/app" }, unset: [] },
  processes,
});

const image = `us-central1-docker.pkg.dev/proj/cira-apps/${SERVICE}:${TAG}`;
const jobContainer = (name: string) =>
  (
    google.jobs.get(name)?.template as {
      template: { containers: Array<Record<string, unknown>> };
    }
  ).template.containers[0]!;
const poolContainer = (name: string) =>
  (google.pools.get(name)?.template as { containers: Array<Record<string, unknown>> })
    .containers[0]!;

describe("an app that is only a scheduled run and a worker", () => {
  it("deploys with no service, and is live once its processes are on the build", async () => {
    const started = await provider().deploy(scriptApp([report, worker]));

    // No web service, no address, and a handle that says so.
    expect(started.url).toBeNull();
    expect(started.providerDeploymentId).toMatch(/:noweb$/);
    expect(google.service).toBeNull();

    // Google's buildpacks want a default command, which a Procfile with no
    // web line does not give them; the build is told the first process's.
    const build = calls.find((c) => c.url.includes("cloudbuild") && c.method === "POST");
    expect(JSON.stringify(build?.body)).toContain("GOOGLE_ENTRYPOINT=python report.py");

    // Created with the environment, switched off, on Google's placeholder
    // until the build exists.
    expect(jobContainer("report-0000app1")).toMatchObject({
      image: "us-docker.pkg.dev/cloudrun/container/job:latest",
      env: [{ name: "DATABASE_URL", value: "postgres://db/app" }],
    });
    expect(google.pools.get("worker-0000app1")?.scaling).toEqual({
      manualInstanceCount: 0,
    });
    // Its timetable exists, and waits.
    expect(google.schedules.get("report-0000app1")).toMatchObject({
      schedule: "0 9 * * 1",
      timeZone: "Etc/UTC",
      state: "PAUSED",
    });

    // The build finishes: the first poll moves them onto it, the next says live.
    const first = await provider().getStatus(started.providerDeploymentId);
    expect(first.status).toBe("deploying");
    expect(jobContainer("report-0000app1")).toMatchObject({
      image,
      ...startCommand("python report.py", "buildpacks"),
      env: [{ name: "DATABASE_URL", value: "postgres://db/app" }],
    });
    expect(poolContainer("worker-0000app1")).toMatchObject({
      image,
      command: ["/cnb/lifecycle/launcher"],
      args: ["python worker.py"],
    });

    const second = await provider().getStatus(started.providerDeploymentId);
    expect(second).toMatchObject({ status: "live", url: null });
  });

  it("switches them on and off with nothing secret, and keeps the timetable", async () => {
    const started = await provider().deploy(scriptApp([report, worker]));
    await provider().getStatus(started.providerDeploymentId);
    const handle = started.providerDeploymentId;

    await provider().setProcess(handle, {
      ...report,
      enabled: true,
      schedule: "30 7 * * *",
      timeoutSeconds: 300,
    });
    expect(google.schedules.get("report-0000app1")).toMatchObject({
      schedule: "30 7 * * *",
      state: "ENABLED",
    });
    expect(
      (google.jobs.get("report-0000app1")?.template as { template: { timeout: string } })
        .template.timeout,
    ).toBe("300s");
    // The environment it was given at deploy is untouched.
    expect(jobContainer("report-0000app1").env).toEqual([
      { name: "DATABASE_URL", value: "postgres://db/app" },
    ]);

    await provider().setProcess(handle, { ...worker, enabled: true });
    expect(google.pools.get("worker-0000app1")?.scaling).toEqual({
      manualInstanceCount: 1,
    });
    await provider().setProcess(handle, { ...worker, enabled: false });
    expect(google.pools.get("worker-0000app1")?.scaling).toEqual({
      manualInstanceCount: 0,
    });

    // No timetable at all: the Scheduler job goes, the Cloud Run job stays.
    await provider().setProcess(handle, { ...report, schedule: null });
    expect(google.schedules.has("report-0000app1")).toBe(false);
    expect(google.jobs.has("report-0000app1")).toBe(true);
  });

  it("gives each its own memory, and changes it with nothing secret", async () => {
    const started = await provider().deploy(scriptApp([report, worker]));
    await provider().getStatus(started.providerDeploymentId);
    const handle = started.providerDeploymentId;

    expect(jobContainer("report-0000app1").resources).toEqual({
      limits: { cpu: "1", memory: "2048Mi" },
    });
    expect(poolContainer("worker-0000app1").resources).toEqual({
      limits: { cpu: "1", memory: "1024Mi" },
    });

    await provider().setProcess(handle, { ...worker, enabled: true, memoryMiB: 4096 });
    expect(poolContainer("worker-0000app1")).toMatchObject({
      image,
      resources: { limits: { cpu: "1", memory: "4096Mi" } },
      env: [{ name: "DATABASE_URL", value: "postgres://db/app" }],
    });
    await provider().setProcess(handle, { ...report, memoryMiB: 512 });
    expect(jobContainer("report-0000app1").resources).toEqual({
      limits: { cpu: "1", memory: "512Mi" },
    });

    const states = await provider().processStates(handle, [
      { name: "worker", kind: "worker" },
      { name: "report", kind: "scheduled" },
    ]);
    expect(states.map((s) => s.memoryMiB)).toEqual([4096, 512]);
  });

  it("notices a worker or a run that ran out of memory", async () => {
    const started = await provider().deploy(scriptApp([report, worker]));
    await provider().getStatus(started.providerDeploymentId);
    const handle = started.providerDeploymentId;
    await provider().setProcess(handle, { ...worker, enabled: true });

    // A worker is restarted and still called ready; only its logs say why.
    google.outOfMemory.set("worker-0000app1", "2026-09-19T11:58:22Z");
    google.executions.set("report-0000app1", [
      {
        name: "e-1",
        startTime: "2026-09-19T09:00:00Z",
        completionTime: "2026-09-19T09:00:40Z",
        failedCount: 1,
        conditions: [
          {
            type: "Completed",
            state: "CONDITION_FAILED",
            message:
              "Task e-1-task0 failed with exit code: 0 and message: The configured memory limit was reached.",
          },
        ],
      },
    ]);

    const [pool, job] = await provider().processStates(handle, [
      { name: "worker", kind: "worker" },
      { name: "report", kind: "scheduled" },
    ]);
    expect(pool).toMatchObject({
      health: "starting",
      outOfMemoryAt: new Date("2026-09-19T11:58:22Z"),
    });
    expect(job?.kind === "scheduled" && job.runs[0]).toMatchObject({
      outcome: "failed",
      outOfMemory: true,
    });

    // Off, it cannot be running out of anything, and its logs are not read.
    await provider().setProcess(handle, { ...worker, enabled: false });
    calls.length = 0;
    const [off] = await provider().processStates(handle, [
      { name: "worker", kind: "worker" },
    ]);
    expect(off).toMatchObject({ outOfMemoryAt: null });
    expect(calls.some((c) => c.url.includes("logging"))).toBe(false);
  });

  it("runs one now, but not while another run is still going", async () => {
    const started = await provider().deploy(scriptApp([report]));
    const handle = started.providerDeploymentId;

    expect(await provider().runProcess(handle, "report")).toEqual({ started: true });
    const again = await provider().runProcess(handle, "report");
    expect(again.started).toBe(false);
    expect(again.reason).toContain("still going");

    const [state] = await provider().processStates(handle, [
      { name: "report", kind: "scheduled" },
    ]);
    expect(state).toMatchObject({ kind: "scheduled", exists: true });
    expect(state?.kind === "scheduled" && state.runs[0]?.outcome).toBe("running");
  });

  it("takes down what the repository stops declaring, timetable and all", async () => {
    // Someone else's job, which must survive.
    google.jobs.set("other-11111111", {
      name: "x/jobs/other-11111111",
      labels: { "cira-app": "acme-other-11111111" },
    });

    await provider().deploy(scriptApp([report, worker]));
    await provider().deploy(scriptApp([worker]));

    expect(google.jobs.has("report-0000app1")).toBe(false);
    expect(google.schedules.has("report-0000app1")).toBe(false);
    expect(google.pools.has("worker-0000app1")).toBe(true);
    expect(google.jobs.has("other-11111111")).toBe(true);
  });

  /**
   * A process can keep its name and change what it is. The old code kept one
   * set of names for both kinds, so a worker that became a scheduled run went
   * on running as a worker too, unseen and billed.
   */
  it("takes down the old kind when a process changes from worker to scheduled run", async () => {
    await provider().deploy(scriptApp([{ ...worker, name: "sync" }]));
    expect(google.pools.has("sync-0000app1")).toBe(true);

    await provider().deploy(
      scriptApp([{ ...report, name: "sync", schedule: "*/15 * * * *" }]),
    );
    expect(google.jobs.has("sync-0000app1")).toBe(true);
    expect(google.pools.has("sync-0000app1")).toBe(false);

    await provider().deploy(scriptApp([{ ...worker, name: "sync" }]));
    expect(google.pools.has("sync-0000app1")).toBe(true);
    expect(google.jobs.has("sync-0000app1")).toBe(false);
    expect(google.schedules.has("sync-0000app1")).toBe(false);
  });

  // One project holds every company's processes, so one page is not all.
  it("finds its processes past the first page of a listing", async () => {
    for (let i = 0; i < 7; i += 1) {
      google.pools.set(`other-${i}`, {
        name: `x/workerPools/other-${i}`,
        labels: { "cira-app": "acme-other-11111111" },
      });
    }
    google.pageLimit = 3;
    await provider().deploy(scriptApp([worker]));
    // Declared again with nothing: the worker must be found to be removed.
    await provider().deploy(scriptApp([report]));
    expect(google.pools.has("worker-0000app1")).toBe(false);
    expect([...google.pools.keys()].filter((k) => k.startsWith("other-"))).toHaveLength(
      7,
    );
  });

  it("carries on past a change Google refuses, and says which it was", async () => {
    await provider().deploy(scriptApp([worker, report]));
    google.refused.add("worker-0000app1");

    const done = provider().deploy(scriptApp([{ ...report, memoryMiB: 4096 }]));
    await expect(done).rejects.toThrow(/removing worker worker-0000app1/);
    // The rest of the deploy's changes were still made.
    expect(jobContainer("report-0000app1").resources).toEqual({
      limits: { cpu: "1", memory: "4096Mi" },
    });
  });

  it("removes every process with the app", async () => {
    const started = await provider().deploy(scriptApp([report, worker]));
    await provider().remove(started.providerDeploymentId);
    expect(google.jobs.size + google.pools.size + google.schedules.size).toBe(0);
  });

  /**
   * The path deleting an app actually takes. It used to take down only the
   * service and the images, leaving every worker running and billing, and
   * every timetable starting code nobody could see.
   */
  it("takes every process down when the app is torn down", async () => {
    await provider().deploy(scriptApp([report, { ...worker, enabled: true }]));
    await provider().teardown(SERVICE);
    expect(google.jobs.size + google.pools.size + google.schedules.size).toBe(0);
  });
});

/**
 * An app with a web service and a worker shares one set of variables. The
 * next set waits on the service while the build runs, and reaches the worker
 * together with the code that reads it.
 */
describe("an app with a web service and a worker", () => {
  const webApp = (env: AppDeploymentInput["env"]): AppDeploymentInput => ({
    ...scriptApp([{ ...worker, enabled: true }]),
    services: [
      { slug: "app", sourcePath: "", dockerfile: null, port: null, ingress: true },
    ],
    env,
  });
  const serviceEnv = () =>
    (google.service?.template as { containers: Array<{ env: unknown }> }).containers[0]
      ?.env;

  it("moves the worker onto new variables only with the new build", async () => {
    const first = await provider().deploy(
      webApp({ set: { DB_URL: "postgres://old" }, unset: [] }),
    );
    await provider().getStatus(first.providerDeploymentId);
    expect(poolContainer("worker-0000app1").env).toEqual([
      { name: "DB_URL", value: "postgres://old" },
    ]);

    // The next deploy renames the variable. Its build is still running.
    google.buildStatus = "WORKING";
    const second = await provider().deploy(
      webApp({ set: { DATABASE_URL: "postgres://new" }, unset: ["DB_URL"] }),
    );
    expect(serviceEnv()).toEqual([{ name: "DATABASE_URL", value: "postgres://new" }]);
    // The worker still runs the old code, so it keeps the name that code reads.
    expect(poolContainer("worker-0000app1").env).toEqual([
      { name: "DB_URL", value: "postgres://old" },
    ]);

    google.buildStatus = "SUCCESS";
    await provider().getStatus(second.providerDeploymentId);
    expect(poolContainer("worker-0000app1").env).toEqual([
      { name: "DATABASE_URL", value: "postgres://new" },
    ]);
  });

  /**
   * Beside a web service the processes are not the app, so a problem with
   * them does not stop the deploy - but it is said, where it used to be
   * dropped.
   */
  it("goes out with a warning when a worker could not be changed", async () => {
    await provider().deploy(webApp({ set: {}, unset: [] }));
    google.refused.add("worker-0000app1");
    const second = await provider().deploy({
      ...webApp({ set: {}, unset: [] }),
      processes: [],
    });
    expect(second.status).toBe("building");
    expect(second.warning).toMatch(/removing worker worker-0000app1/);
  });

  // Nothing polls a deploy after it is live, so this is the last chance to say.
  it("says so when the web app went live and its worker could not follow", async () => {
    const started = await provider().deploy(webApp({ set: {}, unset: [] }));
    google.refused.add("worker-0000app1");
    let status = await provider().getStatus(started.providerDeploymentId);
    for (let poll = 0; poll < 5 && status.status !== "live"; poll += 1) {
      status = await provider().getStatus(started.providerDeploymentId);
    }
    expect(status.status).toBe("live");
    expect(status.warning).toMatch(/still on the previous build/);
  });

  it("takes the web service down when the Procfile stops declaring one", async () => {
    const first = await provider().deploy(
      webApp({ set: { DATABASE_URL: "postgres://db" }, unset: [] }),
    );
    await provider().getStatus(first.providerDeploymentId);
    expect(google.service).not.toBeNull();

    // Only the worker now. Its variables come from the service it replaces.
    const second = await provider().deploy({
      ...scriptApp([{ ...worker, enabled: true }]),
      env: { set: {}, unset: [] },
    });
    // Still serving until the build is ready.
    expect(google.service).not.toBeNull();
    let status = await provider().getStatus(second.providerDeploymentId);
    for (let poll = 0; poll < 5 && status.status !== "live"; poll += 1) {
      status = await provider().getStatus(second.providerDeploymentId);
    }
    expect(status.status).toBe("live");
    expect(google.service).toBeNull();
    expect(poolContainer("worker-0000app1").env).toEqual([
      { name: "DATABASE_URL", value: "postgres://db" },
    ]);
  });

  it("keeps an app of only processes on its variables when a deploy brings none", async () => {
    await provider().deploy(scriptApp([report, worker]));
    await provider().deploy({
      ...scriptApp([report, worker]),
      env: { set: {}, unset: [] },
    });

    expect(jobContainer("report-0000app1").env).toEqual([
      { name: "DATABASE_URL", value: "postgres://db/app" },
    ]);
    expect(poolContainer("worker-0000app1").env).toEqual([
      { name: "DATABASE_URL", value: "postgres://db/app" },
    ]);
  });
});

/**
 * The release command - almost always the migration - runs once per deploy,
 * on the new build with the new variables, before any of it takes traffic.
 */
describe("a release command", () => {
  const withRelease = (command: string | null): AppDeploymentInput => ({
    ...scriptApp([{ ...worker, enabled: true }]),
    services: [
      { slug: "app", sourcePath: "", dockerfile: null, port: null, ingress: true },
    ],
    env: { set: { DATABASE_URL: "postgres://new" }, unset: [] },
    release: command === null ? null : { command, service: "app" },
  });
  const releaseJob = () => google.jobs.get("release-0000app1");

  it("holds the rollout until it has run, on the new build with the new variables", async () => {
    const started = await provider().deploy(withRelease("alembic upgrade head"));
    expect(releaseJob()?.labels).toMatchObject({ "cira-role": "release" });

    // The build is done, and nothing moves until the release has run.
    const waiting = await provider().getStatus(started.providerDeploymentId);
    expect(waiting).toMatchObject({ status: "deploying", release: "needed" });
    expect(
      (google.service?.template as { labels: Record<string, string> }).labels[
        "cira-build"
      ],
    ).toBeUndefined();

    const run = await provider().startRelease(started.providerDeploymentId);
    const container = jobContainer("release-0000app1");
    expect(container.image).toBe(image);
    expect(container.args).toEqual(["alembic upgrade head"]);
    expect(container.env).toEqual([{ name: "DATABASE_URL", value: "postgres://new" }]);
    expect(await provider().releaseState(started.providerDeploymentId, run)).toEqual({
      state: "running",
    });

    const execution = google.executions.get("release-0000app1")![0]!;
    execution.completionTime = new Date().toISOString();
    expect(await provider().releaseState(started.providerDeploymentId, run)).toEqual({
      state: "succeeded",
    });

    // Told it is done, the rollout goes ahead as it always did.
    const rolling = await provider().getStatus(started.providerDeploymentId, {
      releaseDone: true,
    });
    expect(rolling.release).toBeUndefined();
    expect(
      (google.service?.template as { labels: Record<string, string> }).labels[
        "cira-build"
      ],
    ).toBe("b-1");
  });

  it("says why a release failed, without Google's own words", async () => {
    const started = await provider().deploy(withRelease("python manage.py migrate"));
    const run = await provider().startRelease(started.providerDeploymentId);
    Object.assign(google.executions.get("release-0000app1")![0]!, {
      completionTime: new Date().toISOString(),
      failedCount: 1,
      conditions: [
        {
          type: "Completed",
          message:
            "Task release-0000app1-x in project proj failed: The container exited with an exit code of 2.",
        },
      ],
    });
    const state = await provider().releaseState(started.providerDeploymentId, run);
    expect(state).toEqual({
      state: "failed",
      reason:
        "The release command failed (exit code 2). Its output is in the app's logs.",
    });
  });

  it("is not one of the app's processes, and goes when the repository drops it", async () => {
    await provider().deploy(withRelease("alembic upgrade head"));
    const states = await provider().processStates(`b-1:${SERVICE}:${TAG}`, [
      { name: "worker", kind: "worker" },
    ]);
    expect(states).toHaveLength(1);
    // The swap at the end of a build moves processes, never the release.
    await provider().deploy(withRelease(null));
    expect(releaseJob()).toBeUndefined();
  });
});

describe("startCommand", () => {
  it("starts a buildpacks image through its launcher, and a Dockerfile's through a shell", () => {
    expect(startCommand("arq app.workers.settings.WorkerSettings", "buildpacks")).toEqual(
      {
        command: ["/cnb/lifecycle/launcher"],
        args: ["arq app.workers.settings.WorkerSettings"],
      },
    );
    expect(startCommand("node worker.js", "dockerfile")).toEqual({
      command: ["/bin/sh", "-c"],
      args: ["node worker.js"],
    });
  });
});
