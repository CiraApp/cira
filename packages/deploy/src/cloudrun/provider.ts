import type {
  AppDeploymentInput,
  DeploymentLogLine,
  DeploymentProvider,
  DeploymentResult,
} from "@cira/core";
import type { GoogleTokens } from "./auth.js";
import type { CloudRunConfig } from "./config.js";
import { deploymentHandle, imageRef, parseHandle, serviceName } from "./names.js";
import { imageTag, parseArchiveUri, type ParsedArchive } from "./source.js";
import { buildSucceeded, toDeploymentStatus } from "./status.js";

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
const STORAGE = "https://storage.googleapis.com/storage/v1";

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

/** Cloud Run's own default, stated rather than assumed. */
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
  image?: string;
  env?: Array<{ name?: string; value?: string }>;
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
}

/** What one write to a service is allowed to say. */
interface ServiceSpec {
  image: string;
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
    const service = serviceName(app.spaceSlug, app.appSlug);
    const image = this.imageFor(service, imageTag(app.source.uri));
    const archive = parseArchiveUri(app.source.uri);

    const buildId = await this.startBuild(archive, image);

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
    await this.putService(service, {
      image: current?.template?.containers?.[0]?.image ?? image,
      env: app.env,
      labels: current?.template?.labels ?? {},
    });

    return {
      providerDeploymentId: deploymentHandle({
        buildId,
        service,
        tag: imageTag(app.source.uri),
      }),
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
      await this.putService(service, {
        image: this.imageFor(service, tag),
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
    const state = service.terminalCondition?.state;

    if (state === "FALSE") return { status: "failed", url: null };

    if (
      state === "TRUE" &&
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

  async remove(deploymentId: string): Promise<void> {
    const { service } = parseHandle(deploymentId);
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
   * The identity token that opens one app.
   *
   * The audience is the service's own URL, so Cloud Run rejects it for every
   * other service. This is what replaces a stored bypass secret.
   */
  async invocationToken(serviceUrl: string): Promise<string> {
    return this.tokens.identityToken(new URL(serviceUrl).origin);
  }

  private imageFor(service: string, tag: string): string {
    return imageRef({
      region: this.config.region,
      projectId: this.config.projectId,
      repository: this.config.artifactRepo,
      service,
      tag,
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
  private async startBuild(archive: ParsedArchive, image: string): Promise<string> {
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
          steps: [
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
              ],
            },
          ],
          // `--publish` means `pack` pushes the image itself. Naming it under
          // `images` as well would have Cloud Build try to push an image that
          // is not in its local daemon, and fail after a build that worked.
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
    await this.request(`${this.serviceUrl(service)}?allowMissing=true`, {
      method: "PATCH",
      body: JSON.stringify({
        labels: { "managed-by": "cira" },
        ingress: "INGRESS_TRAFFIC_ALL",
        template: {
          labels: spec.labels,
          scaling: { minInstanceCount: 0, maxInstanceCount: 10 },
          containers: [
            {
              image: spec.image,
              ports: [{ name: "http1", containerPort: CONTAINER_PORT }],
              env: Object.entries(spec.env)
                .filter(([name]) => !RESERVED.has(name))
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([name, value]) => ({ name, value })),
              resources: { limits: { cpu: "1", memory: "512Mi" }, cpuIdle: true },
            },
          ],
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
