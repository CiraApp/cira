import {
  RuntimeLogsError,
  type AppDeploymentInput,
  type DeployableService,
  type DeploymentLogLine,
  type DeploymentProvider,
  type DeploymentResult,
  type RuntimeLogPage,
  type RuntimeLogQuery,
} from "@cira/core";
import type { GoogleTokens } from "./auth.js";
import type { CloudRunConfig } from "./config.js";
import {
  deploymentHandle,
  imageRef,
  parseHandle,
  parseSourceObject,
  serviceName,
} from "./names.js";
import {
  runtimeLogFilter,
  toRuntimeLogEntry,
  type GoogleLogEntry,
} from "./runtime-logs.js";
import { imageTag, parseArchiveUri, type ParsedArchive } from "./source.js";
import { buildSucceeded, toDeploymentStatus, toReadiness } from "./status.js";

/**
 * Deploys through Google.
 *
 * The only module in Cira that knows Cloud Build and Cloud Run exist.
 *
 * A deploy here is two acts, which is the shape everything below follows.
 * Cloud Build turns source into an image; Cloud Run turns that image into
 * something serving. They are minutes apart, and Cira has neither a worker nor
 * a request that can wait that long, so the second act is driven from
 * `getStatus` - which runs whenever anyone looks at the app. Every write below
 * is therefore idempotent and safe to run twice at once.
 *
 * Where the environment goes is the other thing worth reading carefully.
 * Values are set on the Cloud Run service and never appear in a build: a build
 * request and its logs are readable by anyone with the project, and putting a
 * database password in a step's arguments would publish it to exactly the
 * audience docs/secrets.md exists to keep it from.
 */

const BUILD_API = "https://cloudbuild.googleapis.com/v1";
const RUN_API = "https://run.googleapis.com/v2";
const ARTIFACTS_API = "https://artifactregistry.googleapis.com/v1";
const STORAGE = "https://storage.googleapis.com/storage/v1";
const LOGGING_API = "https://logging.googleapis.com/v2";

/** Long enough for a cold buildpacks build of a large app, short of forever. */
const BUILD_TIMEOUT = "1200s";

/**
 * Which build the service's current template came from.
 *
 * The record that makes the second act idempotent. Without somewhere to write
 * "this image has already been rolled out", every poll would roll it out
 * again.
 */
const BUILD_LABEL = "cira-build";

/** Cloud Run's own default, used when an image does not name one. */
const CONTAINER_PORT = 8080;

/**
 * Names Cloud Run sets itself, and rejects a service for setting.
 *
 * `PORT` is the one that matters. It is in a great many `.env` files, because
 * it is how you run the thing locally, and a deploy that failed on it would
 * fail with whatever Google says about reserved variables - about a line the
 * developer wrote months ago for an unrelated reason. Cloud Run tells the
 * container which port to listen on, so the value would have been wrong even
 * if it were allowed.
 */
const RESERVED = new Set([
  "PORT",
  "K_SERVICE",
  "K_REVISION",
  "K_CONFIGURATION",
  "CLOUD_RUN_JOB",
  "CLOUD_RUN_EXECUTION",
  "CLOUD_RUN_TASK_INDEX",
  "CLOUD_RUN_TASK_ATTEMPT",
  "CLOUD_RUN_TASK_COUNT",
]);

export class CloudRunError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CloudRunError";
  }
}

interface RunContainer {
  /** Required once there is more than one, and how each is recognised later. */
  name?: string;
  image?: string;
  env?: Array<{ name?: string; value?: string }>;
  ports?: Array<{ name?: string; containerPort?: number }>;
  startupProbe?: { tcpSocket?: { port?: number } };
}

interface RunService {
  uri?: string;
  latestReadyRevision?: string;
  latestCreatedRevision?: string;
  terminalCondition?: { type?: string; state?: string; message?: string };
  template?: { labels?: Record<string, string>; containers?: RunContainer[] };
}

interface Build {
  id?: string;
  status?: string;
  logsBucket?: string;
  createTime?: string;
  startTime?: string;
  source?: { storageSource?: { bucket?: string; object?: string } };
}

/** One container inside the instance. */
interface ContainerPlan {
  name: string;
  image: string;
  /**
   * Where Cloud Run should send traffic, and what it sets `PORT` to. Only the
   * ingress container has one; Cloud Run permits exactly one.
   *
   * Taken from the image when the image says. An app that hardcodes 8000
   * because its Dockerfile says `EXPOSE 8000` is correct if Cira names 8000
   * and unreachable if Cira assumes its own default.
   */
  port: number | null;
  ingress: boolean;
}

/** What one write to a service is allowed to say. */
interface ServiceSpec {
  containers: ContainerPlan[];
  env: Readonly<Record<string, string>>;
  labels: Record<string, string>;
}

export class CloudRunProvider implements DeploymentProvider {
  readonly name = "cloudrun";

  constructor(
    private readonly config: CloudRunConfig,
    private readonly tokens: GoogleTokens,
  ) {}

  async deploy(app: AppDeploymentInput): Promise<DeploymentResult> {
    const service = serviceName({
      spaceSlug: app.spaceSlug,
      appSlug: app.appSlug,
      appId: app.appId,
    });
    const tag = imageTag(app.source.uri);
    const archive = parseArchiveUri(app.source.uri);

    // The tag carries the service's name only when there is more than one to
    // tell apart. An ordinary app keeps the image name it has always had, so
    // nothing about redeploying one changes.
    const several = app.services.length > 1;
    const planned = app.services.map((part) => ({
      ...part,
      image: this.imageFor(service, tag, several ? part.slug : undefined),
    }));

    // One build, not one per service. They share an upload, they succeed or
    // fail as a unit, and one build id is one thing to poll - which is what
    // lets the rest of the deploy stay exactly as it was.
    const buildId = await this.startBuild(archive, planned);

    // The environment is written now, while Cira is holding it, because this
    // is the only moment it has it: Cira stores no values, so nothing later in
    // the deploy could put them back.
    //
    // The image deliberately stays as it is. Pointing a live service at an
    // image that is still being built would replace a working revision with
    // one that cannot start, so a redeploy would take the app down for the
    // length of its own build. The swap happens in `getStatus`, once there is
    // something to swap to.
    const current = await this.getService(service);
    const serving = current?.template?.containers ?? [];
    // By name when there are several, and by position when there is one -
    // because a lone container is written without a name, so there is nothing
    // to match it by. Getting this wrong points a live app at an image that
    // does not exist yet, which is the whole thing the carry-forward prevents.
    const running = new Map(serving.map((c) => [c.name ?? "", c.image]));

    await this.putService(service, {
      containers: planned.map((part) => ({
        name: part.slug,
        image: (several ? running.get(part.slug) : serving[0]?.image) ?? part.image,
        // The front door falls back to Cloud Run's own port; a sidecar keeps
        // whatever it declared and nothing more, because an undeclared port is
        // one nothing can knock on.
        port: part.ingress ? (part.port ?? CONTAINER_PORT) : part.port,
        ingress: part.ingress,
      })),
      env: app.env,
      labels: current?.template?.labels ?? {},
    });

    return {
      providerDeploymentId: deploymentHandle({ buildId, service, tag }),
      status: "building",
      // A redeploy is still serving its previous revision, and saying so is
      // more useful than reporting an app with no address for ten minutes.
      url: current?.uri ?? null,
    };
  }

  /**
   * Where the deploy has got to - and, once the image exists, the act that
   * puts it into service.
   */
  async getStatus(deploymentId: string): Promise<DeploymentResult> {
    const { buildId, service, tag } = parseHandle(deploymentId);
    const build = await this.getBuild(buildId);

    if (!buildSucceeded(build.status)) {
      return {
        providerDeploymentId: deploymentId,
        status: toDeploymentStatus(build.status),
        url: null,
      };
    }

    const current = await this.getService(service);
    if (current === null) {
      // The build produced an image for a service that no longer exists,
      // which means someone removed the app while it was deploying.
      return { providerDeploymentId: deploymentId, status: "removed", url: null };
    }

    if (current.template?.labels?.[BUILD_LABEL] !== buildId) {
      // The environment is read back off the service rather than carried from
      // the deploy, because the deploy is long over. Cira is not storing it -
      // Cloud Run is, which is where a running app's environment belongs. It
      // passes through this process and is written straight back, the same way
      // it passed through on the way in.
      // Every container the deploy wrote, carried forward by name. The names
      // and ports are read back from the service rather than recomputed,
      // because the deploy that knew them is long over - the same reason the
      // environment is read back rather than remembered.
      const containers = (current.template?.containers ?? []).map((c) => ({
        name: c.name ?? "",
        image: this.imageFor(service, tag, c.name === undefined ? undefined : c.name),
        // A sidecar has no `ports` - the only record of where it listens is
        // the probe written to watch it. Losing that here would drop both the
        // probe and the ordering that depends on it, at the moment the built
        // image is rolled out and nobody is looking.
        port: c.ports?.[0]?.containerPort ?? c.startupProbe?.tcpSocket?.port ?? null,
        ingress: (c.ports?.length ?? 0) > 0,
      }));

      await this.putService(service, {
        containers,
        env: envOf(current),
        labels: { ...current.template?.labels, [BUILD_LABEL]: buildId },
      });

      // Changing the template starts a new revision. Its readiness is the next
      // poll's question.
      return { providerDeploymentId: deploymentId, status: "deploying", url: null };
    }

    return {
      providerDeploymentId: deploymentId,
      ...this.readiness(current),
    };
  }

  /**
   * Whether the revision built from this deploy is actually serving.
   *
   * `uri` is populated long before anything answers on it, so it is not the
   * signal. A ready terminal condition with the newest revision also being the
   * newest ready one is: a container that fails to start leaves those two
   * revisions diverged while the condition still reads true from the one
   * before it.
   */
  private readiness(service: RunService): {
    status: DeploymentResult["status"];
    url: string | null;
  } {
    const state = toReadiness(service.terminalCondition?.state);

    if (state === "failed") return { status: "failed", url: null };

    if (
      state === "ready" &&
      service.latestReadyRevision !== undefined &&
      service.latestReadyRevision === service.latestCreatedRevision
    ) {
      return { status: "live", url: service.uri ?? null };
    }

    return { status: "deploying", url: null };
  }

  /**
   * What the build printed.
   *
   * Read from the logs bucket rather than from Cloud Logging. Both hold the
   * same output, but one is a single authenticated GET returning the finished
   * text, and the other is a paged query needing a permission Cira's service
   * account does not have and should not be given for this.
   */
  async getLogs(deploymentId: string): Promise<DeploymentLogLine[]> {
    const { buildId } = parseHandle(deploymentId);
    const build = await this.getBuild(buildId);

    const location = (build.logsBucket ?? `gs://${this.config.sourceBucket}`).replace(
      /^gs:\/\//,
      "",
    );
    const [bucket, ...prefix] = location.split("/").filter((part) => part !== "");
    if (bucket === undefined) return [];

    const object = [...prefix, `log-${buildId}.txt`].join("/");
    const access = await this.tokens.accessToken();

    const response = await fetch(
      `${STORAGE}/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}?alt=media`,
      { headers: { authorization: `Bearer ${access}` } },
    );

    // A build that has not written its log yet is normal, and an empty list
    // reads better than an error on a page someone opened to see progress.
    if (!response.ok) return [];

    // Cloud Build's stored log is plain text with no per-line timestamps, so
    // every line carries the build's own start. The alternative is inventing
    // times that look precise and are not.
    const at = new Date(build.startTime ?? build.createTime ?? Date.now());

    return (await response.text())
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((message) => ({ timestamp: at, message }));
  }

  /**
   * What the app printed while it ran, and the requests that reached it.
   *
   * From Cloud Logging, which is the only place Cloud Run writes them - unlike
   * build output, there is no bucket to read instead, so this is the one call
   * that needs the deployer account to hold Logs Viewer. The service comes
   * from the deployment's own handle and the rest of the query is built in
   * `runtimeLogFilter`, so nothing here can be pointed at another app.
   */
  async getRuntimeLogs(
    deploymentId: string,
    query: RuntimeLogQuery,
  ): Promise<RuntimeLogPage> {
    const { service } = parseHandle(deploymentId);
    const filter = runtimeLogFilter({
      service,
      region: this.config.region,
      since: query.since,
      until: query.until,
      minimum: query.minimum,
      search: query.search,
    });

    const access = await this.tokens.accessToken();
    let response: Response;
    try {
      response = await fetch(`${LOGGING_API}/entries:list`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${access}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          resourceNames: [`projects/${this.config.projectId}`],
          filter,
          orderBy: query.order === "newest" ? "timestamp desc" : "timestamp asc",
          pageSize: Math.min(Math.max(Math.trunc(query.limit), 1), 500),
          ...(query.pageToken === null ? {} : { pageToken: query.pageToken }),
        }),
      });
    } catch {
      throw new RuntimeLogsError("Could not reach Google's logs.", "unavailable");
    }

    // Google's error text names the project and the account, so it is turned
    // into a reason rather than passed on. Its reason code is kept, for whoever
    // runs Cira: a 403 means two very different things, and without the code
    // the only way to tell them apart is to guess.
    if (!response.ok) {
      const code = await googleReason(response);
      if (code === "SERVICE_DISABLED") {
        throw new RuntimeLogsError(
          "Cloud Logging is turned off for this project.",
          "disabled",
          code,
        );
      }
      if (response.status === 403 || response.status === 401) {
        throw new RuntimeLogsError(
          "Cira is not allowed to read this project's logs.",
          "not-allowed",
          code,
        );
      }
      if (response.status === 429) {
        throw new RuntimeLogsError(
          "Google is limiting log reads right now.",
          "busy",
          code,
        );
      }
      throw new RuntimeLogsError(
        `Google would not return the logs (${response.status}).`,
        "unavailable",
        code,
      );
    }

    const body = (await response.json()) as {
      entries?: GoogleLogEntry[];
      nextPageToken?: string;
    };

    return {
      entries: (body.entries ?? []).map(toRuntimeLogEntry),
      nextPageToken:
        typeof body.nextPageToken === "string" && body.nextPageToken !== ""
          ? body.nextPageToken
          : null,
    };
  }

  async remove(deploymentId: string): Promise<void> {
    await this.removeService(parseHandle(deploymentId).service);
  }

  private async removeService(service: string): Promise<void> {
    const access = await this.tokens.accessToken();

    const response = await fetch(this.serviceUrl(service), {
      method: "DELETE",
      headers: { authorization: `Bearer ${access}` },
    });

    // Already gone is the outcome being asked for.
    if (response.ok || response.status === 404) return;
    throw new CloudRunError(
      `Removing the app failed (${response.status}).`,
      response.status,
    );
  }

  /**
   * Remove an app from Google entirely.
   *
   * Two things, not one. `remove` takes the service down, which is what stops
   * it serving - but every deploy also pushed an image, and those stay in
   * Artifact Registry forever with nothing to remove them. An app deleted a
   * year ago would still be paying for the images of every version it ever
   * had.
   *
   * The service goes first. If deleting the images fails the app is already
   * unreachable, which is the part that matters; storage left behind is a bill,
   * not a hazard, so it is reported rather than allowed to block the rest.
   */
  async teardown(service: string): Promise<{ images: boolean }> {
    await this.removeService(service);

    const access = await this.tokens.accessToken();
    const { projectId, region, artifactRepo } = this.config;

    // The package holds every version ever pushed for this service, so one
    // delete is the whole history rather than a tag at a time.
    const response = await fetch(
      `${ARTIFACTS_API}/projects/${projectId}/locations/${region}` +
        `/repositories/${encodeURIComponent(artifactRepo)}` +
        `/packages/${encodeURIComponent(service)}`,
      { method: "DELETE", headers: { authorization: `Bearer ${access}` } },
    );

    return { images: response.ok || response.status === 404 };
  }

  /**
   * The identity token that opens one app.
   *
   * The audience is the service's own URL, so Cloud Run rejects it for every
   * other service. This is what replaces a stored bypass secret.
   */
  async invocationToken(serviceUrl: string): Promise<string> {
    return this.tokens.identityToken(new URL(serviceUrl).origin);
  }

  /**
   * An app's images are named for the app and tagged for the service, so
   * everything belonging to one app sits under one repository entry and comes
   * away together when the app does.
   */
  private imageFor(service: string, tag: string, slug?: string): string {
    return imageRef({
      region: this.config.region,
      projectId: this.config.projectId,
      repository: this.config.artifactRepo,
      service,
      tag: slug === undefined ? tag : `${slug}-${tag}`,
    });
  }

  private serviceUrl(service: string): string {
    const { projectId, region } = this.config;
    return `${RUN_API}/projects/${projectId}/locations/${region}/services/${service}`;
  }

  /**
   * Hand the source to buildpacks.
   *
   * Buildpacks rather than a Dockerfile, because the whole point of moving off
   * a JavaScript-only provider was to stop asking what the app is written in.
   * `pack` detects it from the source.
   *
   * Note what is not here: no substitutions, no environment, nothing from the
   * app's own configuration. A build request and its logs are readable by
   * anyone with access to the project.
   */
  private async startBuild(
    archive: ParsedArchive,
    parts: ReadonlyArray<DeployableService & { image: string }>,
  ): Promise<string> {
    const { projectId, region, serviceAccountEmail, sourceBucket } = this.config;

    const created = await this.request<{ metadata?: { build?: Build } }>(
      `${BUILD_API}/projects/${projectId}/locations/${region}/builds`,
      {
        method: "POST",
        body: JSON.stringify({
          source: {
            storageSource: {
              bucket: archive.bucket,
              object: archive.object,
              generation: archive.generation,
            },
          },
          // Every service in one build, in order. Cloud Build runs steps
          // sequentially, so two halves take about as long as they would apart
          // - and a failure in either fails the deploy, which is the honest
          // outcome for two halves of one app.
          steps: parts.flatMap((part) =>
            part.dockerfile === null
              ? buildpackStep(part.image, part.sourcePath)
              : dockerSteps(part.image, part.dockerfile),
          ),
          // Both paths push the image themselves - `pack --publish` directly,
          // and docker with an explicit push step. Naming it under `images` as
          // well would have Cloud Build try to push an image that is not in its
          // local daemon, and fail after a build that worked.
          timeout: BUILD_TIMEOUT,
          // Named explicitly: new projects no longer have the legacy Cloud
          // Build account, and a build with no service account fails at create
          // time with an error about a principal nobody configured.
          serviceAccount: `projects/${projectId}/serviceAccounts/${serviceAccountEmail}`,
          // A build running as a named account cannot use the default logging,
          // so it is given a bucket Cira owns - which is also what makes the
          // logs readable later without a Cloud Logging permission.
          logsBucket: `gs://${sourceBucket}`,
          options: { logging: "GCS_ONLY" },
        }),
      },
    );

    const id = created.metadata?.build?.id;
    if (typeof id !== "string" || id === "") {
      throw new CloudRunError("Google accepted the build but did not name it.", 502);
    }
    return id;
  }

  /**
   * Which upload this deploy was built from, if Google still has it.
   *
   * Cira does not write this down anywhere, and deliberately does not need to:
   * the build is the record of what was actually used, so asking it cannot
   * disagree with reality and works for every deploy that ever happened rather
   * than only those made after somebody thought to store it.
   *
   * Null when the build is gone, when it recorded no source, or when the path
   * is not one of ours. The archives themselves expire after thirty days, so a
   * path coming back is not a promise the bytes are still there - the caller
   * finds that out by asking for them.
   */
  async sourceOf(
    deploymentId: string,
  ): Promise<{ userId: string; sourceId: string } | null> {
    let build: Build;
    try {
      const { buildId } = parseHandle(deploymentId);
      build = await this.getBuild(buildId);
    } catch {
      return null;
    }

    const object = build.source?.storageSource?.object;
    return object === undefined ? null : parseSourceObject(object);
  }

  private async getBuild(buildId: string): Promise<Build> {
    const { projectId, region } = this.config;
    return this.request<Build>(
      `${BUILD_API}/projects/${projectId}/locations/${region}/builds/${encodeURIComponent(buildId)}`,
    );
  }

  private async getService(service: string): Promise<RunService | null> {
    const access = await this.tokens.accessToken();
    const response = await fetch(this.serviceUrl(service), {
      headers: { authorization: `Bearer ${access}` },
    });

    if (response.status === 404) return null;
    if (!response.ok) {
      throw new CloudRunError(
        `Google would not describe the app (${response.status}).`,
        response.status,
      );
    }
    return (await response.json()) as RunService;
  }

  /**
   * Create or update the service, in one call.
   *
   * `allowMissing` makes a PATCH an upsert, which removes the read-then-branch
   * that every version of this otherwise needs - and with it the window where
   * two concurrent polls both decide the service does not exist yet.
   *
   * No IAM binding is written, ever. A Cloud Run service is unreachable by
   * default and becomes public only by granting `allUsers` the invoker role.
   * Not doing that is the entire access model: the app answers to a token
   * minted for its own URL, and to nothing else.
   */
  private async putService(service: string, spec: ServiceSpec): Promise<void> {
    const several = spec.containers.length > 1;

    const env = Object.entries(spec.env)
      .filter(([name]) => !RESERVED.has(name))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => ({ name, value }));

    // Only a sidecar whose port is known can be depended on: Cloud Run refuses
    // a dependency on a container it cannot tell is up, and what it wants as
    // proof is a startup probe, which needs a port to knock on. A sidecar that
    // never said where it listens is started alongside rather than before,
    // which is what happened before any of this existed.
    const sidecars = spec.containers
      .filter((c) => !c.ingress && c.port !== null)
      .map((c) => c.name);

    await this.request(`${this.serviceUrl(service)}?allowMissing=true`, {
      method: "PATCH",
      body: JSON.stringify({
        labels: { "managed-by": "cira" },
        ingress: "INGRESS_TRAFFIC_ALL",
        template: {
          labels: spec.labels,
          // Extra CPU while the container is starting and nothing is being
          // served yet. It is billed only for that window, and it is the
          // cheapest thing available against a cold start: the alternative is
          // keeping an instance warm around the clock for an app nobody is
          // using at three in the morning.
          annotations: { "run.googleapis.com/startup-cpu-boost": "true" },
          scaling: { minInstanceCount: 0, maxInstanceCount: 10 },
          containers: spec.containers.map((container) => ({
            // Named only when there is more than one, because naming the sole
            // container of an existing service would replace it rather than
            // update it, and every app deployed so far has exactly one.
            ...(several ? { name: container.name } : {}),
            image: container.image,
            ...(container.ingress
              ? {
                  ports: [
                    { name: "http1", containerPort: container.port ?? CONTAINER_PORT },
                  ],
                }
              : {}),
            // The environment goes to every container, the way a single `.env`
            // file does when the same repository is run locally. Cira has no
            // way to know which half wants which name, and a frontend missing
            // the variable its build needs is a worse failure than a backend
            // seeing one it ignores.
            env,
            // Nothing starts before what it depends on. The front door is the
            // half that calls the other, so it waits; a backend that is not
            // listening yet is a proxy error on the first request otherwise.
            ...(container.ingress && sidecars.length > 0 ? { dependsOn: sidecars } : {}),
            // How Cloud Run decides a sidecar is up, and it refuses the
            // dependency above without one. A socket that accepts a connection
            // is the most a platform can know about an arbitrary backend; what
            // "ready" means beyond that is the app's own business.
            ...(!container.ingress && container.port !== null
              ? {
                  startupProbe: {
                    tcpSocket: { port: container.port },
                    // Asked every second, not every five. The front door waits
                    // for this to pass before it takes traffic, so the gap
                    // between the backend actually listening and Cloud Run
                    // noticing is time every cold start pays for and nobody
                    // gets back. A backend that is up in one second should not
                    // wait four more to be asked.
                    periodSeconds: 1,
                    // Cloud Run requires this to be no longer than the period.
                    // A TCP connect to a port inside the same instance is not
                    // a thing that needs longer.
                    timeoutSeconds: 1,
                    // The same hundred seconds of patience as before, now
                    // spent in smaller steps.
                    failureThreshold: 100,
                  },
                }
              : {}),
            resources: resourcesFor(several),
          })),
        },
      }),
    });
  }

  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const access = await this.tokens.accessToken();

    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          authorization: `Bearer ${access}`,
          "content-type": "application/json",
          ...(init.headers ?? {}),
        },
      });
    } catch {
      throw new CloudRunError("Could not reach the deployment provider.", 0);
    }

    if (!response.ok) {
      // Google's error text names service accounts, projects and sometimes the
      // request that failed, so it is summarised rather than handed to
      // whoever is deploying.
      throw new CloudRunError(
        `The deployment provider rejected the request (${response.status}).`,
        response.status,
      );
    }

    return (await response.json()) as T;
  }
}

/** The port a service is already routing to. */
/**
 * What one container is allowed to use.
 *
 * An instance's limits are the sum of its containers', so two halves of an app
 * need roughly twice what one did - 512Mi does not hold a Node server and a
 * Python one at the same time, and the failure is an out-of-memory kill rather
 * than anything that names the cause.
 *
 * `cpuIdle` is the setting that would really have bitten. It throttles CPU
 * outside request handling, which is free and correct for a lone web server
 * and wrong the moment something runs beside it: a backend with a subscriber
 * loop or a queue thread stops being scheduled between requests, and comes
 * back looking like intermittent flakiness rather than a configuration choice.
 */
function resourcesFor(several: boolean): {
  limits: { cpu: string; memory: string };
  cpuIdle: boolean;
} {
  return several
    ? { limits: { cpu: "1", memory: "1Gi" }, cpuIdle: false }
    : { limits: { cpu: "1", memory: "512Mi" }, cpuIdle: true };
}

/**
 * Let buildpacks work out what this is.
 *
 * The reason Cira deploys more than Next.js: `pack` reads the source and
 * decides the language for itself, so nothing here has to know.
 */
function buildpackStep(image: string, sourcePath: string): unknown[] {
  return [
    {
      name: "gcr.io/k8s-skaffold/pack",
      entrypoint: "pack",
      args: [
        "build",
        image,
        "--builder",
        "gcr.io/buildpacks/builder:latest",
        "--network",
        "cloudbuild",
        "--publish",
        // Which part of the upload to read. Empty for an ordinary app, whose
        // whole repository is the thing being built.
        ...(sourcePath === "" ? [] : ["--path", sourcePath]),
      ],
    },
  ];
}

/**
 * Build the image the project already describes.
 *
 * Preferred over buildpacks whenever a Dockerfile exists, because it answers
 * the one question buildpacks cannot: how to start something they did not
 * recognise. Wave's build installed 53 packages and then failed for want of an
 * entrypoint that was written down in a file Cira was ignoring.
 */
function dockerSteps(image: string, dockerfile: string): unknown[] {
  return [
    {
      name: "gcr.io/cloud-builders/docker",
      // The context is always the whole upload and the file is named within
      // it, because those are separate facts in any monorepo. Wave keeps its
      // Dockerfile in `apps/api` and says plainly that the context must be the
      // workspace.
      args: ["build", "-f", dockerfile, "-t", image, "."],
      // BuildKit, because a Dockerfile written any time recently assumes it.
      // `RUN --mount=type=cache` is the common one and it is not an extension
      // people opt into - it is the default everywhere the file was tested,
      // and without it the build fails on a line its author never thought
      // twice about.
      env: ["DOCKER_BUILDKIT=1"],
    },
    { name: "gcr.io/cloud-builders/docker", args: ["push", image] },
  ];
}

/** The environment a service is already running with. */
function envOf(service: RunService): Record<string, string> {
  const entries = service.template?.containers?.[0]?.env ?? [];
  const env: Record<string, string> = {};
  for (const item of entries) {
    if (typeof item.name === "string" && typeof item.value === "string") {
      env[item.name] = item.value;
    }
  }
  return env;
}

/**
 * Google's own name for an error: the most specific reason in its details when
 * there is one (`SERVICE_DISABLED`, `IAM_PERMISSION_DENIED`), else its status
 * (`PERMISSION_DENIED`), else the HTTP status. Nothing else of the body is
 * read, because the rest names accounts and projects.
 */
async function googleReason(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { status?: unknown; details?: Array<{ reason?: unknown }> };
    };
    const detail = body.error?.details?.find((d) => typeof d.reason === "string")?.reason;
    if (typeof detail === "string") return detail;
    if (typeof body.error?.status === "string") return body.error.status;
  } catch {
    // Not JSON; the status is all there is.
  }
  return String(response.status);
}
