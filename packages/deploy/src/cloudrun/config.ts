/**
 * Where Cira's Google project is and what it is called.
 *
 * Every value here is configuration rather than a credential: project ids,
 * region, bucket and repository names, and the email of the service account
 * Cira impersonates. None of it is secret - the secret was the key, and there
 * is no key (see auth.ts). That is worth stating plainly, because a file full
 * of `GCP_*` reads like somewhere secrets would live and it is precisely the
 * file where none do.
 *
 * Read once and reported all at once. Configuring eight variables one failed
 * deploy at a time is a bad afternoon, so a missing setup says everything it
 * is missing in a single sentence.
 */

import { GoogleTokens, type FederationConfig } from "./auth.js";

export interface CloudRunConfig extends FederationConfig {
  projectId: string;
  /** Google's numeric id for the same project. The federation audience needs it. */
  projectNumber: string;
  region: string;
  /** Holds uploaded source archives until Cloud Build has read them. */
  sourceBucket: string;
  /** The Artifact Registry repository built images are pushed to. */
  artifactRepo: string;
}

const REQUIRED = {
  projectId: "GCP_PROJECT_ID",
  projectNumber: "GCP_PROJECT_NUMBER",
  region: "GCP_REGION",
  sourceBucket: "GCP_SOURCE_BUCKET",
  artifactRepo: "GCP_ARTIFACT_REPO",
  serviceAccountEmail: "GCP_SERVICE_ACCOUNT_EMAIL",
  poolId: "GCP_WORKLOAD_IDENTITY_POOL_ID",
  providerId: "GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID",
} as const satisfies Record<keyof CloudRunConfig, string>;

export function cloudRunConfig(
  env: Record<string, string | undefined> = process.env,
): CloudRunConfig {
  const missing: string[] = [];
  const read = (name: string): string => {
    const value = env[name];
    if (value === undefined || value.trim() === "") {
      missing.push(name);
      return "";
    }
    return value.trim();
  };

  const config = Object.fromEntries(
    Object.entries(REQUIRED).map(([key, name]) => [key, read(name)]),
  ) as unknown as CloudRunConfig;

  if (missing.length > 0) {
    throw new Error(`Deployments are not configured. Set ${missing.join(", ")}.`);
  }

  return config;
}

/**
 * One token source per process.
 *
 * Cached because `GoogleTokens` holds the access token it fetched, and a fresh
 * instance per deploy would throw that away and ask Google again every time.
 */
let tokens: GoogleTokens | null = null;

export function googleTokens(config: CloudRunConfig): GoogleTokens {
  tokens ??= new GoogleTokens(config);
  return tokens;
}
