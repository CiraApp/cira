import type {
  AppDeploymentInput,
  DeploymentLogLine,
  DeploymentProvider,
  DeploymentResult,
} from "@cira/core";
import { randomBytes } from "node:crypto";
import { toDeploymentStatus } from "./status.js";

export interface VercelConfig {
  token: string;
  /** The team that owns deployed customer apps. */
  teamId: string;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/**
 * Deploys through Vercel.
 *
 * The only module in Cira that knows Vercel exists. Everything above it works
 * in terms of `DeploymentProvider`, so replacing this file is the whole cost
 * of changing where apps run.
 */
export class VercelProvider implements DeploymentProvider {
  readonly name = "vercel";

  constructor(private readonly config: VercelConfig) {}

  private async request<T>(
    path: string,
    init: RequestInit & { raw?: Buffer } = {},
  ): Promise<T> {
    const separator = path.includes("?") ? "&" : "?";
    const url = `https://api.vercel.com${path}${separator}teamId=${this.config.teamId}`;

    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          authorization: `Bearer ${this.config.token}`,
          ...(init.headers ?? {}),
        },
      });
    } catch {
      throw new ProviderError("Could not reach the deployment provider.", 0);
    }

    if (!response.ok) {
      // Provider error text can carry account details, so it is summarised
      // rather than passed through to whoever is deploying.
      throw new ProviderError(
        `The deployment provider rejected the request (${response.status}).`,
        response.status,
      );
    }

    return (await response.json()) as T;
  }

  /**
   * Upload one file, addressed by its own SHA-1.
   *
   * Content-addressed, so re-deploying a project only moves the files that
   * actually changed.
   */
  async uploadFile(sha: string, size: number, body: Buffer): Promise<void> {
    const url = `https://api.vercel.com/v2/files?teamId=${this.config.teamId}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.token}`,
        "content-type": "application/octet-stream",
        "content-length": String(size),
        "x-vercel-digest": sha,
      },
      body: new Uint8Array(body),
    });

    // 409 means the provider already holds this content, which is success.
    if (!response.ok && response.status !== 409) {
      throw new ProviderError(
        `Uploading a file failed (${response.status}).`,
        response.status,
      );
    }
  }

  async deploy(app: AppDeploymentInput): Promise<DeploymentResult> {
    const created = await this.request<{
      id: string;
      url?: string;
      readyState?: string;
      status?: string;
    }>("/v13/deployments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: `${app.spaceSlug}-${app.appSlug}`,
        target: "production",
        files: app.files.map((f) => ({ file: f.path, sha: f.sha, size: f.size })),
        projectSettings: { framework: app.framework },
        meta: { ciraAppId: app.appId },
      }),
    });

    return {
      providerDeploymentId: created.id,
      status: toDeploymentStatus(created.readyState ?? created.status),
      url: created.url === undefined ? null : `https://${created.url}`,
    };
  }

  /**
   * Make a deployed app unreachable except through Cira.
   *
   * Two steps that only make sense together: protect every URL including
   * production, then mint a secret Cira can use to let an approved employee
   * in. Protection without the secret locks everyone out; the secret without
   * protection secures nothing.
   */
  async secureProject(
    projectName: string,
  ): Promise<{ projectId: string; accessSecret: string }> {
    const project = await this.request<{ id: string }>(
      `/v9/projects/${encodeURIComponent(projectName)}`,
    );

    await this.request(`/v9/projects/${encodeURIComponent(project.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ssoProtection: { deploymentType: "all" } }),
    });

    const accessSecret = randomBypassSecret();
    await this.request(
      `/v1/projects/${encodeURIComponent(project.id)}/protection-bypass`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ generate: { secret: accessSecret } }),
      },
    );

    return { projectId: project.id, accessSecret };
  }

  async getStatus(deploymentId: string): Promise<DeploymentResult> {
    const d = await this.request<{
      id: string;
      url?: string;
      readyState?: string;
      status?: string;
    }>(`/v13/deployments/${encodeURIComponent(deploymentId)}`);

    return {
      providerDeploymentId: d.id,
      status: toDeploymentStatus(d.readyState ?? d.status),
      url: d.url === undefined ? null : `https://${d.url}`,
    };
  }

  async getLogs(deploymentId: string): Promise<DeploymentLogLine[]> {
    const events = await this.request<
      Array<{
        created?: number;
        date?: number;
        text?: string;
        payload?: { text?: string };
      }>
    >(`/v2/deployments/${encodeURIComponent(deploymentId)}/events?builds=1`);

    if (!Array.isArray(events)) return [];

    return events
      .map((e) => ({
        timestamp: new Date(e.created ?? e.date ?? Date.now()),
        message: (e.text ?? e.payload?.text ?? "").trimEnd(),
      }))
      .filter((line) => line.message !== "");
  }

  async remove(deploymentId: string): Promise<void> {
    await this.request(`/v13/deployments/${encodeURIComponent(deploymentId)}`, {
      method: "DELETE",
    });
  }
}

/** The provider requires exactly 32 alphanumeric characters. */
function randomBypassSecret(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from(randomBytes(32), (b) => alphabet[b % alphabet.length]).join("");
}
