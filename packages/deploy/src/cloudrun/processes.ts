import {
  DEFAULT_LIMITS,
  type ProcessRun,
  type ProcessSpec,
  type ProcessState,
  type ReleaseSpec,
  type ReleaseState,
} from "@cira/core";
import type { GoogleTokens } from "./auth.js";
import type { CloudRunConfig } from "./config.js";
import { processResourceName } from "./names.js";

/**
 * Workers and scheduled runs on Google.
 *
 * A worker is a Cloud Run worker pool: a container with no port, kept at one
 * instance while it is on and none while it is off. A scheduled run is a
 * Cloud Run Job, and its timetable is a Cloud Scheduler job that starts it -
 * Scheduler calls Google directly, as Cira's own service account, so Cira is
 * never the thing that has to be up for a 3 a.m. report to run.
 *
 * Both run the app's own image with a different command. They are created
 * when the app is deployed, because that is the only moment Cira holds the
 * app's environment, and the environment is written to them then and never
 * read by anything but the next deploy's image swap - the same bargain the
 * web service has always had. After that, switching one on or off, or giving
 * it a timetable, touches nothing secret, which is why a page can do it.
 */

const RUN_API = "https://run.googleapis.com/v2";
const SCHEDULER_API = "https://cloudscheduler.googleapis.com/v1";
const LOGGING_API = "https://logging.googleapis.com/v2";

/** Google's own public images, run only until the app's build is ready. */
const PLACEHOLDER = {
  job: "us-docker.pkg.dev/cloudrun/container/job:latest",
  worker: "us-docker.pkg.dev/cloudrun/container/worker-pool:latest",
} as const;

/**
 * What a worker or scheduled run is given: a web instance's CPU, and the
 * memory its repository or a person chose.
 */
function resources(memoryMiB: number): { limits: Record<string, string> } {
  return {
    limits: { cpu: String(DEFAULT_LIMITS.app.cpu), memory: `${memoryMiB}Mi` },
  };
}

/** A container's memory as Cloud Run writes it back: "512Mi", "1Gi", "2G". */
function memoryOf(container: Container | undefined): number | null {
  const text = container?.resources?.limits?.["memory"];
  if (text === undefined) return null;
  const match = /^(\d+(?:\.\d+)?)(Mi|Gi|M|G)?$/.exec(text);
  if (match === null) return null;
  const amount = Number(match[1]);
  const unit = match[2] ?? "";
  if (unit === "Gi") return Math.round(amount * 1024);
  if (unit === "G") return Math.round((amount * 1000 ** 3) / 1024 ** 2);
  if (unit === "M") return Math.round((amount * 1000 ** 2) / 1024 ** 2);
  if (unit === "Mi") return Math.round(amount);
  return Math.round(amount / 1024 ** 2);
}

/**
 * The line Cloud Run's own logging writes when a container is killed for
 * using more memory than it was given. For a worker it is the only sign: the
 * instance is restarted and the pool keeps saying it is ready.
 */
const OUT_OF_MEMORY_LOG = "Out-of-memory event detected in container";

/** How a failed run's condition says the same thing. */
const OUT_OF_MEMORY_RUN = /memory limit was reached/i;

/** Which app a resource belongs to, so a deploy can find all of them. */
const APP_LABEL = "cira-app";
/** The build a resource was last moved onto, as the web service records it. */
const BUILD_LABEL = "cira-build";
/**
 * Marks the job that runs an app's release command. It is not one of the
 * app's processes: nothing switches it on, nothing moves it at the swap, and
 * it runs only when a deploy asks it to.
 */
const ROLE_LABEL = "cira-role";
const RELEASE = "release";

/** How long one release may run: a large migration, and no longer. */
const RELEASE_TIMEOUT_SECONDS = 30 * 60;

/**
 * Carried on each resource because the image swap at the end of a deploy has
 * nothing else to go on: the deploy that knew them is over. The command is the
 * one the repository now declares, applied with the new image rather than
 * before it, so a worker never runs a new command on an old build.
 */
const COMMAND = "cira.dev/command";
const PART = "cira.dev/part";
const BUILDER = "cira.dev/builder";

/** A failure a page should explain rather than just report. */
export class ProcessError extends Error {
  constructor(
    message: string,
    readonly reason: "scheduler-off" | "not-allowed" | "missing" | "failed",
    readonly status: number,
  ) {
    super(message);
    this.name = "ProcessError";
  }
}

interface Container {
  image?: string;
  command?: string[];
  args?: string[];
  env?: Array<{ name?: string; value?: string }>;
  resources?: { limits?: Record<string, string> };
}

interface JobResource {
  name?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  template?: {
    labels?: Record<string, string>;
    taskCount?: number;
    template?: { containers?: Container[]; timeout?: string; maxRetries?: number };
  };
}

interface PoolResource {
  name?: string;
  updateTime?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  scaling?: { manualInstanceCount?: number };
  template?: { labels?: Record<string, string>; containers?: Container[] };
  terminalCondition?: { state?: string };
}

interface Execution {
  name?: string;
  createTime?: string;
  startTime?: string;
  completionTime?: string;
  succeededCount?: number;
  failedCount?: number;
  cancelledCount?: number;
  runningCount?: number;
  conditions?: Array<{ type?: string; state?: string; message?: string }>;
}

/** How an image is started with a command of the repository's choosing. */
export type Builder = "buildpacks" | "dockerfile";

/**
 * A command, as a container is told to run it. An image built by buildpacks
 * has to be started through its launcher, which is what puts the app's own
 * toolchain - its virtualenv, its node_modules - on the path; a Dockerfile's
 * image is started through a shell, which is what a Procfile line means.
 */
export function startCommand(
  command: string,
  builder: Builder,
): { command: string[]; args: string[] } {
  return builder === "buildpacks"
    ? { command: ["/cnb/lifecycle/launcher"], args: [command] }
    : { command: ["/bin/sh", "-c"], args: [command] };
}

/** A process's containers with its memory changed and nothing else. */
function withMemory(
  containers: Container[] | undefined,
  memoryMiB: number,
): Container[] | undefined {
  return containers?.map((container, i) =>
    i === 0
      ? {
          ...container,
          resources: {
            ...container.resources,
            limits: { ...container.resources?.limits, memory: `${memoryMiB}Mi` },
          },
        }
      : container,
  );
}

export class CloudRunProcesses {
  constructor(
    private readonly config: CloudRunConfig,
    private readonly tokens: GoogleTokens,
    private readonly imageFor: (service: string, tag: string, part?: string) => string,
  ) {}

  /**
   * Create or update every declared process, and remove the ones the
   * repository no longer declares. Existing processes keep running their
   * current image and command until the build is ready; new ones start from
   * Google's placeholder, switched off.
   *
   * `holdEnv` keeps an existing process on the variables it already has. An
   * app with a web service holds its next variables on that service until the
   * build is ready, and they reach the processes at `swap`, together with the
   * code that expects them - so a renamed variable never meets the old code.
   * An app that is only processes has nowhere else to hold them, so they are
   * written now.
   */
  async deploy(args: {
    service: string;
    processes: readonly ProcessSpec[];
    env: Readonly<Record<string, string>>;
    holdEnv: boolean;
    /** Per service slug: how its image is built, and its part of the image name. */
    parts: ReadonlyMap<string, { builder: Builder; imagePart: string }>;
    /** The release command, or null to take any previous one away. */
    release?: ReleaseSpec | null;
  }): Promise<void> {
    const env = envList(args.env);
    await this.writeRelease(args, env);

    const existingJobs = await this.jobsOf(args.service);
    const existingPools = await this.poolsOf(args.service);

    // Every write is tried, and every failure is kept, rather than the first
    // one stopping the rest: one process Google refuses should not leave a
    // removed worker running, and nothing that went wrong is swallowed.
    const problems: string[] = [];
    const attempt = async (what: string, act: () => Promise<unknown>) => {
      try {
        await act();
      } catch (error) {
        problems.push(`${what}: ${error instanceof Error ? error.message : "failed"}`);
      }
    };

    // A few at a time rather than one after another: each is a write and, for
    // a scheduled run, a timetable too, and twenty of them in a row ran past
    // the time the request that started the deploy is given.
    await inBatches(args.processes, WRITES_AT_ONCE, async (process) => {
      const part = args.parts.get(process.service) ?? {
        builder: "buildpacks",
        imagePart: "",
      };
      const name = processResourceName(args.service, process.name);
      const annotations = {
        [COMMAND]: process.command,
        [PART]: part.imagePart,
        [BUILDER]: part.builder,
      };
      const labels = { "managed-by": "cira", [APP_LABEL]: args.service };

      if (process.kind === "scheduled") {
        const existing = existingJobs.find((j) => leaf(j.name) === name);
        const current = existing?.template?.template?.containers?.[0];
        await attempt(`scheduled run ${process.name}`, async () => {
          await this.write(`${this.jobUrl(name)}?allowMissing=true`, "PATCH", {
            labels,
            annotations,
            template: {
              labels: existing?.template?.labels ?? {},
              taskCount: 1,
              template: {
                containers: [
                  {
                    image: current?.image ?? PLACEHOLDER.job,
                    ...(current?.command !== undefined
                      ? { command: current.command, args: current.args ?? [] }
                      : {}),
                    env:
                      args.holdEnv && current !== undefined ? (current.env ?? []) : env,
                    resources: resources(process.memoryMiB),
                  },
                ],
                timeout: `${process.timeoutSeconds}s`,
                maxRetries: 0,
              },
            },
          });
        });
        // A timetable failing to apply does not undo the deploy: the job is
        // there, and the page says what is missing.
        await this.syncSchedule(args.service, process).catch(() => undefined);
      } else {
        const existing = existingPools.find((p) => leaf(p.name) === name);
        const current = existing?.template?.containers?.[0];
        await attempt(`worker ${process.name}`, () =>
          this.write(`${this.poolUrl(name)}?allowMissing=true`, "PATCH", {
            labels,
            annotations,
            // A new worker starts off: it is running Google's placeholder until
            // the build is ready, and nobody has turned it on yet anyway.
            scaling: {
              manualInstanceCount: existing === undefined ? 0 : process.enabled ? 1 : 0,
            },
            template: {
              labels: existing?.template?.labels ?? {},
              containers: [
                {
                  image: current?.image ?? PLACEHOLDER.worker,
                  ...(current?.command !== undefined
                    ? { command: current.command, args: current.args ?? [] }
                    : {}),
                  env: args.holdEnv && current !== undefined ? (current.env ?? []) : env,
                  resources: resources(process.memoryMiB),
                },
              ],
            },
          }),
        );
      }
    });

    // Anything the repository stopped declaring is taken down, timetable and
    // all, rather than left running something nobody can see. By kind: a
    // process that keeps its name and becomes a scheduled run is a job now,
    // and the worker pool it used to be is not declared by anything.
    const named = (kind: ProcessSpec["kind"]) =>
      new Set(
        args.processes
          .filter((p) => p.kind === kind)
          .map((p) => processResourceName(args.service, p.name)),
      );
    const jobs = named("scheduled");
    const pools = named("worker");
    for (const job of existingJobs) {
      const name = leaf(job.name);
      if (jobs.has(name)) continue;
      await attempt(`removing scheduled run ${name}`, async () => {
        await this.remove(this.schedulerUrl(name));
        await this.remove(this.jobUrl(name));
      });
    }
    for (const pool of existingPools) {
      const name = leaf(pool.name);
      if (pools.has(name)) continue;
      await attempt(`removing worker ${name}`, () => this.remove(this.poolUrl(name)));
    }

    if (problems.length > 0) {
      throw new ProcessError(
        `Google refused ${problems.length === 1 ? "one change" : `${problems.length} changes`} to this app's workers and scheduled runs - ${problems.join("; ")}.`,
        "failed",
        0,
      );
    }
  }

  /**
   * Move every process onto the build that just finished, with the command
   * the repository declares. Returns whether anything was still to move, so
   * a caller can tell "done" from "just done".
   */
  async swap(args: {
    service: string;
    tag: string;
    buildId: string;
    /** The variables to move onto, when they were held elsewhere during the build. */
    env?: Readonly<Record<string, string>>;
  }): Promise<boolean> {
    let moved = false;
    for (const job of await this.jobsOf(args.service)) {
      if (job.template?.labels?.[BUILD_LABEL] === args.buildId) continue;
      const container = job.template?.template?.containers?.[0] ?? {};
      await this.write(this.jobUrl(leaf(job.name)), "PATCH", {
        labels: job.labels,
        annotations: job.annotations,
        template: {
          labels: { ...job.template?.labels, [BUILD_LABEL]: args.buildId },
          taskCount: job.template?.taskCount ?? 1,
          template: {
            timeout: job.template?.template?.timeout,
            maxRetries: job.template?.template?.maxRetries ?? 0,
            containers: [this.onBuild(container, job.annotations, args)],
          },
        },
      });
      moved = true;
    }
    for (const pool of await this.poolsOf(args.service)) {
      if (pool.template?.labels?.[BUILD_LABEL] === args.buildId) continue;
      const container = pool.template?.containers?.[0] ?? {};
      await this.write(this.poolUrl(leaf(pool.name)), "PATCH", {
        labels: pool.labels,
        annotations: pool.annotations,
        scaling: pool.scaling,
        template: {
          labels: { ...pool.template?.labels, [BUILD_LABEL]: args.buildId },
          containers: [this.onBuild(container, pool.annotations, args)],
        },
      });
      moved = true;
    }
    return moved;
  }

  /** Put one process into the state a person chose. Needs no secrets. */
  async set(service: string, process: ProcessSpec): Promise<void> {
    const name = processResourceName(service, process.name);
    if (process.kind === "worker") {
      const pool = await this.read<PoolResource>(this.poolUrl(name));
      if (pool === null) {
        throw new ProcessError(
          "This worker has not been created yet. Deploy the app again.",
          "missing",
          404,
        );
      }
      await this.write(this.poolUrl(name), "PATCH", {
        labels: pool.labels,
        annotations: pool.annotations,
        template: {
          labels: pool.template?.labels,
          containers: withMemory(pool.template?.containers, process.memoryMiB),
        },
        scaling: { manualInstanceCount: process.enabled ? 1 : 0 },
      });
      return;
    }

    const job = await this.read<JobResource>(this.jobUrl(name));
    if (job === null) {
      throw new ProcessError(
        "This scheduled run has not been created yet. Deploy the app again.",
        "missing",
        404,
      );
    }
    await this.write(this.jobUrl(name), "PATCH", {
      labels: job.labels,
      annotations: job.annotations,
      template: {
        labels: job.template?.labels,
        taskCount: job.template?.taskCount ?? 1,
        template: {
          containers: withMemory(job.template?.template?.containers, process.memoryMiB),
          maxRetries: job.template?.template?.maxRetries ?? 0,
          timeout: `${process.timeoutSeconds}s`,
        },
      },
    });
    await this.syncSchedule(service, process);
  }

  /** Start a scheduled run now. Refused while one is still going. */
  async run(
    service: string,
    process: string,
  ): Promise<{ started: boolean; reason?: string }> {
    const name = processResourceName(service, process);
    const recent = await this.executions(name, 5);
    if (recent.some((run) => run.outcome === "running")) {
      return {
        started: false,
        reason: "A run is still going. It can be started again once it ends.",
      };
    }
    const response = await this.fetch(`${this.jobUrl(name)}:run`, "POST", {});
    if (response.status === 404) {
      return {
        started: false,
        reason: "This scheduled run has not been created yet. Deploy the app again.",
      };
    }
    if (!response.ok) throw failure(response.status, await googleReason(response));
    return { started: true };
  }

  async states(
    service: string,
    processes: readonly Pick<ProcessSpec, "name" | "kind">[],
  ): Promise<ProcessState[]> {
    return Promise.all(
      processes.map(async (process): Promise<ProcessState> => {
        const name = processResourceName(service, process.name);
        if (process.kind === "worker") {
          const pool = await this.read<PoolResource>(this.poolUrl(name));
          const instances = pool?.scaling?.manualInstanceCount ?? 0;
          const state = pool?.terminalCondition?.state;
          return {
            kind: "worker",
            name: process.name,
            instances,
            health:
              pool === null
                ? "missing"
                : state === "CONDITION_FAILED"
                  ? "failed"
                  : state === "CONDITION_SUCCEEDED"
                    ? "ready"
                    : "starting",
            memoryMiB: memoryOf(pool?.template?.containers?.[0]),
            // Only a worker that is on can be running out of memory now.
            outOfMemoryAt:
              pool === null || instances === 0
                ? null
                : await this.lastOutOfMemory(name, pool.updateTime),
          };
        }
        const job = await this.read<JobResource>(this.jobUrl(name));
        return {
          kind: "scheduled",
          name: process.name,
          exists: job !== null,
          memoryMiB: memoryOf(job?.template?.template?.containers?.[0]),
          runs: job === null ? [] : await this.executions(name, 5),
        };
      }),
    );
  }

  /** Everything this app runs besides its web service, gone. */
  async removeAll(service: string): Promise<void> {
    await this.remove(this.jobUrl(processResourceName(service, RELEASE)));
    for (const job of await this.jobsOf(service)) {
      const name = leaf(job.name);
      await this.remove(this.schedulerUrl(name));
      await this.remove(this.jobUrl(name));
    }
    for (const pool of await this.poolsOf(service))
      await this.remove(this.poolUrl(leaf(pool.name)));
  }

  /**
   * The variables this app's processes run with, for an app with no web
   * service to read them from. Read back from Google, where they are kept;
   * Cira holds none of its own.
   */
  async currentEnv(service: string): Promise<Record<string, string>> {
    const pools = await this.poolsOf(service);
    const jobs = await this.jobsOf(service);
    const container =
      pools[0]?.template?.containers?.[0] ?? jobs[0]?.template?.template?.containers?.[0];
    const env: Record<string, string> = {};
    for (const item of container?.env ?? []) {
      if (typeof item.name === "string" && typeof item.value === "string") {
        env[item.name] = item.value;
      }
    }
    return env;
  }

  /** Whether the app has any processes at all, for an app with no service. */
  async any(service: string): Promise<boolean> {
    return (await this.jobsOf(service)).length + (await this.poolsOf(service)).length > 0;
  }

  // -- the release command ----------------------------------------------------

  /**
   * Write the job that runs the release command, or take it away when the
   * repository no longer has one. Like a new process it starts on Google's
   * placeholder and moves onto the build when the release is started.
   */
  private async writeRelease(
    args: {
      service: string;
      holdEnv: boolean;
      parts: ReadonlyMap<string, { builder: Builder; imagePart: string }>;
      release?: ReleaseSpec | null;
    },
    env: Array<{ name: string; value: string }>,
  ): Promise<void> {
    const name = processResourceName(args.service, RELEASE);
    const release = args.release ?? null;
    if (release === null) {
      await this.remove(this.jobUrl(name));
      return;
    }
    const part = args.parts.get(release.service) ?? {
      builder: "buildpacks" as const,
      imagePart: "",
    };
    const existing = await this.read<JobResource>(this.jobUrl(name));
    const current = existing?.template?.template?.containers?.[0];
    await this.write(`${this.jobUrl(name)}?allowMissing=true`, "PATCH", {
      labels: { "managed-by": "cira", [APP_LABEL]: args.service, [ROLE_LABEL]: RELEASE },
      annotations: {
        [COMMAND]: release.command,
        [PART]: part.imagePart,
        [BUILDER]: part.builder,
      },
      template: {
        labels: existing?.template?.labels ?? {},
        taskCount: 1,
        template: {
          containers: [
            {
              image: current?.image ?? PLACEHOLDER.job,
              ...(current?.command !== undefined
                ? { command: current.command, args: current.args ?? [] }
                : {}),
              env: args.holdEnv && current !== undefined ? (current.env ?? []) : env,
              resources: resources(DEFAULT_LIMITS.processes.defaultMemoryMiB),
            },
          ],
          timeout: `${RELEASE_TIMEOUT_SECONDS}s`,
          // A migration that fails is not tried again unasked: a half-applied
          // one run twice is how a database ends up somewhere nobody meant.
          maxRetries: 0,
        },
      },
    });
  }

  /** Whether this app has a release command to run before a deploy goes out. */
  async hasRelease(service: string): Promise<boolean> {
    return (
      (await this.read<JobResource>(
        this.jobUrl(processResourceName(service, RELEASE)),
      )) !== null
    );
  }

  /**
   * Move the release job onto the build and start it, with the variables the
   * new version will run with. Returns the run's name.
   */
  async startRelease(args: {
    service: string;
    tag: string;
    buildId: string;
    env?: Readonly<Record<string, string>>;
  }): Promise<string> {
    const name = processResourceName(args.service, RELEASE);
    const job = await this.read<JobResource>(this.jobUrl(name));
    if (job === null)
      throw new ProcessError("This app has no release command.", "missing", 404);
    const container = job.template?.template?.containers?.[0] ?? {};
    await this.write(this.jobUrl(name), "PATCH", {
      labels: job.labels,
      annotations: job.annotations,
      template: {
        labels: { ...job.template?.labels, [BUILD_LABEL]: args.buildId },
        taskCount: 1,
        template: {
          timeout: job.template?.template?.timeout,
          maxRetries: 0,
          containers: [this.onBuild(container, job.annotations, args)],
        },
      },
    });
    // The run must use what was just written, so it waits for Google to have
    // applied it: an update is an operation, and a run started while it is
    // still in progress would run the previous build's code.
    for (let wait = 0; wait < 30; wait += 1) {
      const now = await this.read<JobResource & { reconciling?: boolean }>(
        this.jobUrl(name),
      );
      if (now?.reconciling !== true) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const started = await this.write<{ metadata?: { name?: string } }>(
      `${this.jobUrl(name)}:run`,
      "POST",
      {},
    );
    const run = leaf(started.metadata?.name);
    if (run === "")
      throw new ProcessError(
        "Google started the release but did not name it.",
        "failed",
        502,
      );
    return run;
  }

  /** How one release run is going. */
  async releaseState(service: string, run: string): Promise<ReleaseState> {
    const name = processResourceName(service, RELEASE);
    const execution = await this.read<Execution>(
      `${this.jobUrl(name)}/executions/${run}`,
    );
    if (execution === null) {
      return { state: "failed", reason: "The release run could not be found." };
    }
    if (execution.completionTime === undefined) return { state: "running" };
    if ((execution.failedCount ?? 0) > 0 || (execution.cancelledCount ?? 0) > 0) {
      const said = (execution.conditions ?? []).map((c) => c.message ?? "").join(" ");
      const code = /exit code of (\d+)/i.exec(said)?.[1];
      return {
        state: "failed",
        reason: OUT_OF_MEMORY_RUN.test(said)
          ? "The release command ran out of memory."
          : `The release command failed${code === undefined ? "" : ` (exit code ${code})`}. Its output is with this deploy.`,
      };
    }
    return { state: "succeeded" };
  }

  // -- timetables --------------------------------------------------------------

  /**
   * Make Cloud Scheduler's job match the process: absent with no timetable,
   * otherwise present with it, paused unless the process is on. Scheduler
   * starts the Cloud Run Job itself, as Cira's service account.
   */
  private async syncSchedule(service: string, process: ProcessSpec): Promise<void> {
    const name = processResourceName(service, process.name);
    const url = this.schedulerUrl(name);

    if (process.kind !== "scheduled" || process.schedule === null) {
      await this.remove(url);
      return;
    }

    const { projectId, region, serviceAccountEmail } = this.config;
    const body = {
      name: `projects/${projectId}/locations/${region}/jobs/${name}`,
      schedule: process.schedule,
      timeZone: "Etc/UTC",
      httpTarget: {
        uri: `${this.jobUrl(name)}:run`,
        httpMethod: "POST",
        oauthToken: {
          serviceAccountEmail,
          scope: "https://www.googleapis.com/auth/cloud-platform",
        },
      },
      // A run that fails is a failed run, not one to try again unasked: the
      // next one comes on the timetable, and a repeat may not be safe.
      retryConfig: { retryCount: 0 },
    };

    const existing = await this.read<{ state?: string }>(url);
    let state = existing?.state;
    if (existing === null) {
      const created = await this.write<{ state?: string }>(
        `${SCHEDULER_API}/projects/${projectId}/locations/${region}/jobs`,
        "POST",
        body,
      );
      state = created.state ?? "ENABLED";
    } else {
      await this.write(
        `${url}?updateMask=schedule,timeZone,httpTarget,retryConfig`,
        "PATCH",
        body,
      );
    }

    if (process.enabled && state === "PAUSED")
      await this.write(`${url}:resume`, "POST", {});
    if (!process.enabled && state !== "PAUSED")
      await this.write(`${url}:pause`, "POST", {});
  }

  // -- reading Google -----------------------------------------------------------

  private async executions(job: string, count: number): Promise<ProcessRun[]> {
    const listed = await this.read<{ executions?: Execution[] }>(
      `${this.jobUrl(job)}/executions?pageSize=${count}`,
    );
    return (listed?.executions ?? []).map((e) => ({
      id: leaf(e.name),
      startedAt: new Date(e.startTime ?? e.createTime ?? 0),
      finishedAt: e.completionTime === undefined ? null : new Date(e.completionTime),
      outcome:
        e.completionTime === undefined
          ? "running"
          : (e.failedCount ?? 0) > 0
            ? "failed"
            : (e.cancelledCount ?? 0) > 0
              ? "cancelled"
              : "succeeded",
      outOfMemory: (e.conditions ?? []).some((c) =>
        OUT_OF_MEMORY_RUN.test(c.message ?? ""),
      ),
    }));
  }

  /**
   * When a worker last ran out of memory: since it was last changed, so
   * giving it more clears the warning, and within a day, so an old incident
   * does not hang over a worker that has been fine since. One small read of
   * its logs. A worker whose logs cannot be read is not called healthy or
   * unhealthy on their account - it just has no warning.
   */
  private async lastOutOfMemory(
    pool: string,
    updateTime: string | undefined,
  ): Promise<Date | null> {
    const dayAgo = Date.now() - 24 * 3600_000;
    const changed = updateTime === undefined ? 0 : Date.parse(updateTime);
    const since = new Date(Math.max(dayAgo, Number.isNaN(changed) ? 0 : changed));
    const filter = [
      'resource.type="cloud_run_worker_pool"',
      `resource.labels.worker_pool_name="${pool}"`,
      `resource.labels.location="${this.config.region}"`,
      `textPayload:"${OUT_OF_MEMORY_LOG}"`,
      `timestamp>="${since.toISOString()}"`,
    ].join(" AND ");
    try {
      const response = await this.fetch(`${LOGGING_API}/entries:list`, "POST", {
        resourceNames: [`projects/${this.config.projectId}`],
        filter,
        orderBy: "timestamp desc",
        pageSize: 1,
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { entries?: Array<{ timestamp?: string }> };
      const at = body.entries?.[0]?.timestamp;
      return at === undefined ? null : new Date(at);
    } catch {
      return null;
    }
  }

  private async jobsOf(service: string): Promise<JobResource[]> {
    const { projectId, region } = this.config;
    const all = await this.everyPage<JobResource>(
      `${RUN_API}/projects/${projectId}/locations/${region}/jobs`,
      "jobs",
    );
    return all.filter(
      (j) => j.labels?.[APP_LABEL] === service && j.labels?.[ROLE_LABEL] !== RELEASE,
    );
  }

  private async poolsOf(service: string): Promise<PoolResource[]> {
    const { projectId, region } = this.config;
    const all = await this.everyPage<PoolResource>(
      `${RUN_API}/projects/${projectId}/locations/${region}/workerPools`,
      "workerPools",
    );
    return all.filter((p) => p.labels?.[APP_LABEL] === service);
  }

  /**
   * Every page of a listing. One page of 500 used to be read: past that, the
   * resources of every app are shared across one project, a running worker
   * went unseen, and a deploy could not take down what it could not see.
   */
  private async everyPage<T>(base: string, key: string): Promise<T[]> {
    const all: T[] = [];
    let token: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      const url = `${base}?pageSize=500${token === undefined ? "" : `&pageToken=${encodeURIComponent(token)}`}`;
      const listed = await this.read<
        Record<string, unknown> & { nextPageToken?: string }
      >(url);
      const items = listed?.[key];
      if (Array.isArray(items)) all.push(...(items as T[]));
      token = listed?.nextPageToken;
      if (token === undefined || token === "") return all;
    }
    return all;
  }

  /** The container a process runs, on the build that just finished. */
  private onBuild(
    container: Container,
    annotations: Record<string, string> | undefined,
    args: { service: string; tag: string; env?: Readonly<Record<string, string>> },
  ): Container {
    const part = annotations?.[PART] ?? "";
    const builder: Builder =
      annotations?.[BUILDER] === "dockerfile" ? "dockerfile" : "buildpacks";
    const command = annotations?.[COMMAND];
    return {
      ...container,
      image: this.imageFor(args.service, args.tag, part === "" ? undefined : part),
      ...(command === undefined ? {} : startCommand(command, builder)),
      ...(args.env === undefined ? {} : { env: envList(args.env) }),
    };
  }

  private jobUrl(name: string): string {
    const { projectId, region } = this.config;
    return `${RUN_API}/projects/${projectId}/locations/${region}/jobs/${name}`;
  }

  private poolUrl(name: string): string {
    const { projectId, region } = this.config;
    return `${RUN_API}/projects/${projectId}/locations/${region}/workerPools/${name}`;
  }

  private schedulerUrl(name: string): string {
    const { projectId, region } = this.config;
    return `${SCHEDULER_API}/projects/${projectId}/locations/${region}/jobs/${name}`;
  }

  // -- talking to Google -------------------------------------------------------

  private async fetch(url: string, method: string, body?: unknown): Promise<Response> {
    const access = await this.tokens.accessToken();
    try {
      return await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${access}`,
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ProcessError("Could not reach Google.", "failed", 0);
    }
  }

  /** A resource, or null when it does not exist. */
  private async read<T>(url: string): Promise<T | null> {
    const response = await this.fetch(url, "GET");
    if (response.status === 404) return null;
    if (!response.ok) throw failure(response.status, await googleReason(response));
    return (await response.json()) as T;
  }

  private async write<T = unknown>(
    url: string,
    method: string,
    body: unknown,
  ): Promise<T> {
    const response = await this.fetch(url, method, body);
    if (!response.ok) throw failure(response.status, await googleReason(response));
    const text = await response.text();
    return (text === "" ? {} : JSON.parse(text)) as T;
  }

  /** Gone either way. */
  private async remove(url: string): Promise<void> {
    const response = await this.fetch(url, "DELETE");
    if (response.ok || response.status === 404) return;
    throw failure(response.status, await googleReason(response));
  }
}

/** How many process writes a deploy has in flight at once. */
const WRITES_AT_ONCE = 4;

/** Run `act` over `items`, at most `size` at a time. */
async function inBatches<T>(
  items: readonly T[],
  size: number,
  act: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(act));
  }
}

/** Google's refusals, as reasons. Its own words name accounts and projects. */
function failure(status: number, code: string): ProcessError {
  if (code === "SERVICE_DISABLED") {
    return new ProcessError(
      "Cloud Scheduler is not switched on for this Google Cloud project, so timetables cannot be set yet.",
      "scheduler-off",
      status,
    );
  }
  if (status === 403) {
    return new ProcessError(
      "Cira's service account is not allowed to manage this yet.",
      "not-allowed",
      status,
    );
  }
  return new ProcessError(`Google refused the change (${status}).`, "failed", status);
}

/** Variables as Cloud Run takes them, in a stable order. */
function envList(
  env: Readonly<Record<string, string>>,
): Array<{ name: string; value: string }> {
  return Object.entries(env)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => ({ name, value }));
}

async function googleReason(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { status?: unknown; details?: Array<{ reason?: unknown }> };
    };
    const detail = body.error?.details?.find((d) => typeof d.reason === "string")?.reason;
    if (typeof detail === "string") return detail;
    if (typeof body.error?.status === "string") return body.error.status;
  } catch {
    // Not JSON.
  }
  return String(response.status);
}

function leaf(name: string | undefined): string {
  return (name ?? "").split("/").pop() ?? "";
}
