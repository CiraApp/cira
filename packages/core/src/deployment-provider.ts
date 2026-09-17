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
  /**
   * Build-time and run-time variables.
   *
   * Values pass through and are never stored by Cira or written to a log; see
   * docs/secrets.md. A name prefixed `NEXT_PUBLIC_` is compiled into the
   * browser bundle by the build, which is the caller's problem to warn about,
   * not this interface's to prevent.
   */
  env: Readonly<Record<string, string>>;
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
  remove(deploymentId: string): Promise<void>;
}
