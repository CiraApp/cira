/**
 * Redis caches for apps, made on Upstash.
 *
 * The second thing an internal tool tends to want after a database: somewhere
 * to keep sessions, rate limits, a job queue or a slow answer for a minute.
 * Like databases (../neon/databases.ts), each app gets its own - an Upstash
 * database of its own with its own password, in Cira's Upstash account and in
 * the same Google region as the apps, so a cache hit does not cross a
 * continent. Cira keeps which cache is whose and no address.
 */

const API = "https://api.upstash.com/v2/redis";

export interface UpstashConfig {
  /** The account's email and a management API key, Upstash's Basic auth. */
  email: string;
  apiKey: string;
  /** A Google region Upstash runs in, the apps' own. */
  region: string;
}

export function upstashConfigFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): UpstashConfig | null {
  const email = env["UPSTASH_EMAIL"];
  const apiKey = env["UPSTASH_API_KEY"];
  if (!email || !apiKey) return null;
  return { email, apiKey, region: env["UPSTASH_REGION"] || "us-central1" };
}

export interface ProvisionedCache {
  id: string;
  /** `rediss://default:{password}@{endpoint}:{port}`, what Redis clients take. */
  url: string;
}

export class UpstashError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "UpstashError";
  }
}

interface RawDatabase {
  database_id: string;
  endpoint: string;
  port: number;
  password?: string;
}

type Fetch = typeof fetch;

export class UpstashCaches {
  constructor(
    private readonly config: UpstashConfig,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async create(name: string): Promise<ProvisionedCache> {
    const made = await this.call<RawDatabase>("POST", "/database", {
      database_name: name.slice(0, 64),
      platform: "gcp",
      primary_region: this.config.region,
      tls: true,
      // A cache, so what it cannot hold goes rather than every write failing.
      eviction: true,
    });
    return { id: made.database_id, url: await this.urlOf(made) };
  }

  /** The address of a cache made earlier, asked of Upstash rather than kept. */
  async url(id: string): Promise<string> {
    return this.urlOf(
      await this.call<RawDatabase>("GET", `/database/${encodeURIComponent(id)}`),
    );
  }

  /** Deletes the cache and everything in it. Already gone counts as done. */
  async remove(id: string): Promise<void> {
    try {
      await this.call("DELETE", `/database/${encodeURIComponent(id)}`);
    } catch (error) {
      if (error instanceof UpstashError && error.status === 404) return;
      throw error;
    }
  }

  private async urlOf(raw: RawDatabase): Promise<string> {
    if (raw.password === undefined || raw.password === "") {
      throw new UpstashError("Upstash gave no password for the cache.", 502);
    }
    return `rediss://default:${encodeURIComponent(raw.password)}@${raw.endpoint}:${raw.port}`;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const auth = Buffer.from(`${this.config.email}:${this.config.apiKey}`).toString(
      "base64",
    );
    const response = await this.fetchImpl(`${API}${path}`, {
      method,
      headers: {
        authorization: `Basic ${auth}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    if (!response.ok) {
      // Upstash answers errors as a bare string, sometimes JSON-quoted.
      const said = text.replace(/^"|"$/g, "").trim();
      throw new UpstashError(
        said || `Upstash answered ${response.status}.`,
        response.status,
      );
    }
    return (text === "" ? {} : JSON.parse(text)) as T;
  }
}
