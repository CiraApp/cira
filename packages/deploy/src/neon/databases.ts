/**
 * Postgres databases for apps, made on Neon.
 *
 * Almost every internal tool keeps something - a table of orders, a queue of
 * approvals - and until this an app deployed to Cira had to bring a database
 * from somewhere Cira could not see. Now Cira can make one: its own Neon
 * project per app, in Cira's Neon organisation, never inside Cira's own
 * database. A project is Neon's unit of isolation - its own Postgres, its own
 * roles, its own storage - so one app can never reach another's data, and
 * removing an app removes exactly its project.
 *
 * Cira keeps which project belongs to which app and nothing else. The
 * connection string is Neon's to hold and Cloud Run's to run with; it passes
 * through Cira on the way to the app, as every variable does
 * (docs/secrets.md), and can be asked of Neon again when a person needs it.
 */

const API = "https://console.neon.tech/api/v2";

export interface NeonConfig {
  /** An organisation API key: it can make and delete projects, nothing else of anyone's. */
  apiKey: string;
  /** The organisation the projects are made in. */
  orgId: string;
  /** Where they run. Neon runs on AWS and Azure; this is the one nearest the apps. */
  region: string;
}

/** Null when this Cira has no Neon organisation to make databases in. */
export function neonConfigFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): NeonConfig | null {
  const apiKey = env["NEON_API_KEY"];
  const orgId = env["NEON_ORG_ID"];
  if (apiKey === undefined || apiKey === "" || orgId === undefined || orgId === "") {
    return null;
  }
  return { apiKey, orgId, region: env["NEON_REGION"] || "aws-us-east-1" };
}

/** Where an app's database is, as the app is given it. */
export interface DatabaseUrls {
  /** Through Neon's pooler: what a server with many instances should use. */
  pooled: string;
  /** Straight to Postgres: what migrations and session features need. */
  direct: string;
}

export interface ProvisionedDatabase {
  projectId: string;
  databaseName: string;
  roleName: string;
  urls: DatabaseUrls;
}

export class NeonError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "NeonError";
  }
}

type Fetch = typeof fetch;

export class NeonDatabases {
  constructor(
    private readonly config: NeonConfig,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  /** A new project with one database and its owner role, ready to connect to. */
  async create(name: string): Promise<ProvisionedDatabase> {
    const body = await this.call<{
      project: { id: string };
      connection_uris?: Array<{
        connection_uri: string;
        connection_parameters: {
          database: string;
          role: string;
          host: string;
          pooler_host?: string;
        };
      }>;
    }>("POST", "/projects", {
      project: {
        name: name.slice(0, 64),
        region_id: this.config.region,
        org_id: this.config.orgId,
      },
    });

    const first = body.connection_uris?.[0];
    if (first === undefined) {
      // Made, but with nothing to connect to: not something to hand an app.
      await this.remove(body.project.id).catch(() => undefined);
      throw new NeonError(
        "Neon made the database but gave no way to connect to it.",
        502,
      );
    }
    const params = first.connection_parameters;
    return {
      projectId: body.project.id,
      databaseName: params.database,
      roleName: params.role,
      urls: {
        direct: first.connection_uri,
        pooled:
          params.pooler_host === undefined
            ? pooledFrom(first.connection_uri, params.host)
            : first.connection_uri.replace(`@${params.host}`, `@${params.pooler_host}`),
      },
    };
  }

  /** The addresses of a database made earlier, asked of Neon rather than kept. */
  async urls(args: {
    projectId: string;
    databaseName: string;
    roleName: string;
  }): Promise<DatabaseUrls> {
    const ask = (pooled: boolean) =>
      this.call<{ uri: string }>(
        "GET",
        `/projects/${encodeURIComponent(args.projectId)}/connection_uri?${new URLSearchParams(
          {
            database_name: args.databaseName,
            role_name: args.roleName,
            pooled: String(pooled),
          },
        )}`,
      ).then((body) => body.uri);
    const [pooled, direct] = await Promise.all([ask(true), ask(false)]);
    return { pooled, direct };
  }

  /** Deletes the project and everything in it. Already gone counts as done. */
  async remove(projectId: string): Promise<void> {
    try {
      await this.call("DELETE", `/projects/${encodeURIComponent(projectId)}`);
    } catch (error) {
      if (error instanceof NeonError && error.status === 404) return;
      throw error;
    }
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const said = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      throw new NeonError(
        said?.message ?? `Neon answered ${response.status}.`,
        response.status,
      );
    }
    return (await response.json().catch(() => ({}))) as T;
  }
}

/** Neon's pooler is the same host with `-pooler` after the endpoint's name. */
function pooledFrom(uri: string, host: string): string {
  const [endpoint, ...rest] = host.split(".");
  return uri.replace(`@${host}`, `@${[`${endpoint}-pooler`, ...rest].join(".")}`);
}
