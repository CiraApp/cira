import type { RuntimeLogPage, RuntimeLogQuery } from "./runtime-logs.js";
import type { DeploymentStatus } from "./model.js";

/**
 * The seam between Cira and whoever actually runs the code.
 *
 * Cira does not own compute. Everything above this interface stays unchanged
 * if the provider is later swapped again, so nothing outside a provider
 * implementation may reference a provider's own API, types, or vocabulary.
 */

/**
 * What the source appears to be written in.
 *
 * A hint, not a gate. Cira used to refuse anything that was not Next.js,
 * because the provider it had could not run anything else - and the effect was
 * that Cira only ever saw frontends. The builder now detects the language from
 * the source itself, so this exists to say something useful on an app's page,
 * never to decide whether a deploy may proceed. `unknown` is a normal answer.
 */
export const FRAMEWORKS = [
  "nextjs",
  "node",
  "python",
  "go",
  "ruby",
  "java",
  "php",
  "dotnet",
  "unknown",
] as const;

export type Framework = (typeof FRAMEWORKS)[number];

/**
 * Where the provider can read this deploy's source.
 *
 * One archive rather than a list of hashed files. The previous shape was
 * content-addressed so that a redeploy moved only what changed, which is a
 * real saving, but it only works against a provider that keeps a store of
 * loose files to deduplicate against. Paying for that generality with a
 * per-file upload round trip, when no provider Cira uses can benefit from it,
 * is the wrong trade.
 *
 * The URI's scheme is the provider's business. Nothing above this interface
 * parses it.
 */
export interface SourceArchive {
  uri: string;
  /** Bytes, as stored. Uncompressed size is not knowable without unpacking. */
  size: number;
}

/**
 * What the source says about building and running itself, when it says.
 *
 * Null means it said nothing and the provider should work it out. Present
 * means there is a Dockerfile, and its author already answered a question the
 * provider would otherwise have to guess at.
 */
export interface ContainerHints {
  /**
   * Where the Dockerfile is, relative to the root of the uploaded source.
   *
   * Not always the root. A monorepo routinely keeps the file with the service
   * and the build context at the workspace, so the two are separate facts.
   */
  dockerfile: string;
  /** The port the image declares, or null when it declares none. */
  port: number | null;
}

export interface AppDeploymentInput {
  appId: string;
  spaceSlug: string;
  appSlug: string;
  framework: Framework;
  source: SourceArchive;
  /**
   * The things to build and run, in one instance, sharing localhost.
   *
   * Almost always one. An app that is a frontend with an API behind it has two,
   * and they belong together rather than apart: a frontend written to proxy to
   * its backend in development finds it at the same address in production,
   * because in development it was already talking to localhost.
   *
   * Exactly one of them takes the port and receives requests. The rest sit
   * beside it, reachable only from inside the instance, which is what keeps a
   * backend private without any of them needing an address of its own.
   */
  services: readonly DeployableService[];
  /** Instances to keep running when nobody is asking. Zero unless paid for. */
  minInstances?: number;
  /**
   * Build-time and run-time variables.
   *
   * Values pass through and are never stored by Cira or written to a log; see
   * docs/secrets.md. A name prefixed `NEXT_PUBLIC_` is compiled into the
   * browser bundle by the build, which is the caller's problem to warn about,
   * not this interface's to prevent.
   */
  env: Readonly<Record<string, string>>;
  /**
   * Workers and scheduled runs, each from one of `services`' images with its
   * own command. Created now, while the environment is in hand - it is never
   * stored, so this is the only moment it can be given to them - and moved
   * onto the new image when the build finishes. An app none of whose
   * services takes the port is only these: no service, and no address.
   */
  processes: readonly ProcessSpec[];
}

/** One worker or scheduled run, as the provider needs it. */
export interface ProcessSpec {
  name: string;
  kind: "worker" | "scheduled";
  command: string;
  /** The slug of the service whose image it runs. */
  service: string;
  /** Cron in UTC. Null for a worker, or a run with no timetable yet. */
  schedule: string | null;
  /** How long one run may take. Ignored for a worker. */
  timeoutSeconds: number;
  /** MiB, one of the sizes the limits offer; always with one CPU. */
  memoryMiB: number;
  enabled: boolean;
}

/** How a worker or scheduled run is doing, from the provider. */
export type ProcessState =
  | {
      kind: "worker";
      name: string;
      /** Instances asked for: 1 when on, 0 when off. */
      instances: number;
      health: "ready" | "starting" | "failed" | "missing";
      /** MiB it is actually given, or null when it does not exist. */
      memoryMiB: number | null;
      /**
       * The last time it ran out of memory and was restarted, since it was
       * last changed and within the last day. A worker that does this keeps
       * restarting while its provider still calls it ready, so this is the
       * only sign.
       */
      outOfMemoryAt: Date | null;
    }
  | {
      kind: "scheduled";
      name: string;
      exists: boolean;
      /** MiB each run is actually given, or null when it does not exist. */
      memoryMiB: number | null;
      runs: ProcessRun[];
    };

/** One execution of a scheduled run. */
export interface ProcessRun {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  outcome: "running" | "succeeded" | "failed" | "cancelled";
  /** Failed because it used more memory than it was given. */
  outOfMemory: boolean;
}

export interface DeployableService {
  /** Names the container, and distinguishes its image from its siblings'. */
  slug: string;
  /** Where in the archive it builds from. Empty for the root. */
  sourcePath: string;
  /** Named from the archive root, since that is the build context. */
  dockerfile: string | null;
  /** What its Dockerfile said it listens on, when it said. */
  port: number | null;
  /** Whether this is the one that takes the port and receives requests. */
  ingress: boolean;
}

export interface DeploymentResult {
  providerDeploymentId: string;
  status: DeploymentStatus;
  url: string | null;
}

export interface DeploymentLogLine {
  timestamp: Date;
  message: string;
}

export interface DeploymentProvider {
  readonly name: string;

  deploy(app: AppDeploymentInput): Promise<DeploymentResult>;

  /**
   * Where the deploy has got to, and where it ends up.
   *
   * Allowed to act, not only to read. A deploy is more than one step at every
   * provider worth using, and the later steps have to be driven by something;
   * Cira has no background worker, so they are driven from here, which is
   * called whenever anyone looks at the app. Implementations must therefore be
   * idempotent and safe to call concurrently.
   */
  getStatus(deploymentId: string): Promise<DeploymentResult>;

  getLogs(deploymentId: string): Promise<DeploymentLogLine[]>;

  /**
   * What the app has printed while running, and the requests that reached it.
   *
   * Any deployment of the app will do: runtime logs belong to the app's
   * service, which every one of its deployments shares, so this reads the same
   * whichever build is serving. Throws `RuntimeLogsError`.
   */
  getRuntimeLogs(deploymentId: string, query: RuntimeLogQuery): Promise<RuntimeLogPage>;

  /**
   * Put one process into the state a person chose: a worker on or off, a
   * scheduled run on or off with its timetable and time allowed. Needs no
   * secrets - those were given to the process when it was deployed - which is
   * what lets it be changed from a page at any time.
   */
  setProcess(deploymentId: string, process: ProcessSpec): Promise<void>;

  /** Start a scheduled run now, off its timetable. Refused while one is going. */
  runProcess(
    deploymentId: string,
    name: string,
  ): Promise<{ started: boolean; reason?: string }>;

  /** How each process is doing: a worker's health, a scheduled run's recent runs. */
  processStates(
    deploymentId: string,
    processes: readonly Pick<ProcessSpec, "name" | "kind">[],
  ): Promise<ProcessState[]>;

  remove(deploymentId: string): Promise<void>;
}
