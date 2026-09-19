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

  handle(url: string, method: string, body: unknown): Response {
    const u = new URL(url);
    const path = u.pathname;
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), { status });
    const missing = () => json({ error: { status: "NOT_FOUND" } }, 404);

    if (u.host.startsWith("cloudbuild")) {
      return method === "POST"
        ? json({ metadata: { build: { id: "b-1" } } })
        : json({ id: "b-1", status: this.buildStatus });
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
      return this.service === null ? missing() : json(this.service);
    }
    const kinds: Array<[string, Map<string, Doc>, string]> = [
      ["/jobs", this.jobs, "jobs"],
      ["/workerPools", this.pools, "workerPools"],
    ];
    for (const [segment, store, listKey] of kinds) {
      if (path.endsWith(segment) && method === "GET")
        return json({ [listKey]: [...store.values()] });
      const at = path.indexOf(`${segment}/`);
      if (at === -1) continue;
      const rest = path.slice(at + segment.length + 1);
      const [name, sub] = rest.split("/");
      const bare = (name ?? "").replace(/:run$/, "");
      if (sub === "executions")
        return json({ executions: this.executions.get(bare) ?? [] });
      if (name?.endsWith(":run")) {
        if (!store.has(bare)) return missing();
        const list = this.executions.get(bare) ?? [];
        list.unshift({
          name: `e-${list.length + 1}`,
          createTime: new Date().toISOString(),
        });
        this.executions.set(bare, list);
        return json({ name: "operations/run" });
      }
      if (method === "GET") return store.has(bare) ? json(store.get(bare)) : missing();
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

beforeEach(() => {
  google = new FakeGoogle();
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const raw = init?.body;
    return google.handle(
      String(input),
      init?.method ?? "GET",
      typeof raw === "string" ? JSON.parse(raw) : undefined,
    );
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
  enabled: false,
};
const worker: ProcessSpec = {
  name: "worker",
  kind: "worker",
  command: "python worker.py",
  service: "app",
  schedule: null,
  timeoutSeconds: 600,
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
  env: { DATABASE_URL: "postgres://db/app" },
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

  it("removes every process with the app", async () => {
    const started = await provider().deploy(scriptApp([report, worker]));
    await provider().remove(started.providerDeploymentId);
    expect(google.jobs.size + google.pools.size + google.schedules.size).toBe(0);
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
