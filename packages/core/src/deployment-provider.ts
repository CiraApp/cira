import type { DeploymentStatus } from "./model.js";

/**
 * The seam between Cira and whoever actually runs the code.
 *
 * Cira does not own compute. Everything above this interface stays unchanged
 * if the provider is later swapped for Fly, Cloudflare, AWS, or a custom
 * runtime (spec sections 4 and 12), so nothing outside a provider
 * implementation may reference a provider's own API, types, or vocabulary.
 */

export type Framework = "nextjs";

/**
 * One file of a project's source, addressed by its own hash.
 *
 * Content-addressed rather than a single archive, so redeploying moves only
 * what changed. Providers that want an archive can assemble one; providers
 * that deduplicate can skip what they already hold.
 */
export interface SourceFile {
  /** Path relative to the project root, as the build should see it. */
  path: string;
  size: number;
  sha: string;
}

export interface AppDeploymentInput {
  appId: string;
  spaceSlug: string;
  appSlug: string;
  framework: Framework;
  files: readonly SourceFile[];
  /** Build-time and run-time variables. Never surfaced to a browser. */
  env: Readonly<Record<string, string>>;
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
  getStatus(deploymentId: string): Promise<DeploymentResult>;
  getLogs(deploymentId: string): Promise<DeploymentLogLine[]>;
  remove(deploymentId: string): Promise<void>;
}
