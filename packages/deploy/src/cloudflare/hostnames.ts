/**
 * A company's own hostname for an app, served through Cloudflare.
 *
 * Every app already answers at `{app}--{space}.cira.dev` through the app
 * proxy, a Cloudflare Worker on Cira's zone. A company's own name -
 * `tools.acme.com` - reaches the same Worker as a Cloudflare custom hostname:
 * the company points a CNAME at Cira's target, Cloudflare proves the name is
 * theirs by serving a token over it, issues a certificate, and from then on
 * requests for it arrive at the Worker like any other.
 *
 * Nothing is served for a name until its owner's DNS points at Cira, so
 * claiming someone else's name gets nobody anything.
 */

const API = "https://api.cloudflare.com/client/v4";

export interface CloudflareConfig {
  /** Needs, on the zone: SSL and Certificates, DNS, and Workers Routes, all Edit. */
  apiToken: string;
  zoneId: string;
  /** The name companies point their CNAME at, e.g. `domains.cira.dev`. */
  target: string;
}

export function cloudflareConfigFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): CloudflareConfig | null {
  const apiToken = env["CLOUDFLARE_API_TOKEN"];
  const zoneId = env["CLOUDFLARE_ZONE_ID"];
  const target = env["CIRA_DOMAINS_TARGET"];
  if (!apiToken || !zoneId || !target) return null;
  return { apiToken, zoneId, target };
}

/** Where a hostname has got to. */
export type HostnameState =
  /** Waiting for its CNAME to point at Cira, or for its certificate. */
  | "pending"
  /** Serving, with a certificate. */
  | "active"
  /** Cloudflare gave up; the reason says why. */
  | "failed";

export interface HostnameStatus {
  id: string;
  hostname: string;
  state: HostnameState;
  /** What is holding it up, in Cloudflare's words, when something is. */
  reason: string | null;
}

export class CloudflareError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | null,
  ) {
    super(message);
    this.name = "CloudflareError";
  }
}

interface RawHostname {
  id: string;
  hostname: string;
  status: string;
  ssl?: { status?: string; validation_errors?: Array<{ message?: string }> };
  verification_errors?: string[];
}

type Fetch = typeof fetch;

export class CloudflareHostnames {
  constructor(
    private readonly config: CloudflareConfig,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  get target(): string {
    return this.config.target;
  }

  async create(hostname: string): Promise<HostnameStatus> {
    const raw = await this.call<RawHostname>("POST", this.zone("/custom_hostnames"), {
      hostname,
      ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } },
    });
    return statusOf(raw);
  }

  async get(id: string): Promise<HostnameStatus | null> {
    try {
      return statusOf(
        await this.call<RawHostname>(
          "GET",
          this.zone(`/custom_hostnames/${encodeURIComponent(id)}`),
        ),
      );
    } catch (error) {
      if (error instanceof CloudflareError && error.status === 404) return null;
      throw error;
    }
  }

  /** Already gone counts as removed. */
  async remove(id: string): Promise<void> {
    try {
      await this.call("DELETE", this.zone(`/custom_hostnames/${encodeURIComponent(id)}`));
    } catch (error) {
      if (error instanceof CloudflareError && error.status === 404) return;
      throw error;
    }
  }

  /**
   * Make the zone able to take custom hostnames at all, and say whether
   * anything had to change: a proxied record for the target, the target as
   * the fallback origin every custom hostname is served from, and a Worker
   * route that catches every hostname rather than only Cira's own.
   */
  async ensureZone(script: string): Promise<boolean> {
    let changed = false;

    const records = await this.call<Array<{ id: string; proxied: boolean }>>(
      "GET",
      this.zone(`/dns_records?name=${encodeURIComponent(this.config.target)}`),
    );
    if (records.length === 0) {
      // The address is a placeholder: every request is answered by the Worker
      // before it would reach one. It only has to exist, and be proxied.
      await this.call("POST", this.zone("/dns_records"), {
        type: "AAAA",
        name: this.config.target,
        content: "100::",
        proxied: true,
        comment: "Cira: where companies' own hostnames point. Answered by the app proxy.",
      });
      changed = true;
    }

    const fallback = await this.call<{ origin?: string } | null>(
      "GET",
      this.zone("/custom_hostnames/fallback_origin"),
    ).catch(() => null);
    if (fallback?.origin !== this.config.target) {
      await this.call("PUT", this.zone("/custom_hostnames/fallback_origin"), {
        origin: this.config.target,
      });
      changed = true;
    }

    const routes = await this.call<Array<{ pattern: string; script?: string }>>(
      "GET",
      this.zone("/workers/routes"),
    );
    if (!routes.some((route) => route.pattern === "*/*" && route.script === script)) {
      await this.call("POST", this.zone("/workers/routes"), { pattern: "*/*", script });
      changed = true;
    }

    return changed;
  }

  private zone(path: string): string {
    return `/zones/${encodeURIComponent(this.config.zoneId)}${path}`;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.config.apiToken}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    const parsed = (await response.json().catch(() => null)) as {
      success?: boolean;
      result?: T;
      errors?: Array<{ code?: number; message?: string }>;
    } | null;
    if (!response.ok || parsed?.success === false) {
      const first = parsed?.errors?.[0];
      throw new CloudflareError(
        first?.message ?? `Cloudflare answered ${response.status}.`,
        response.status,
        first?.code ?? null,
      );
    }
    return parsed?.result as T;
  }
}

function statusOf(raw: RawHostname): HostnameStatus {
  const ssl = raw.ssl?.status ?? "";
  const active = raw.status === "active" && ssl === "active";
  const failed =
    raw.status === "blocked" ||
    raw.status === "moved" ||
    raw.status === "deleted" ||
    /timed_out|expired|deleted/.test(ssl);
  const reason =
    raw.verification_errors?.[0] ?? raw.ssl?.validation_errors?.[0]?.message ?? null;
  return {
    id: raw.id,
    hostname: raw.hostname,
    state: active ? "active" : failed ? "failed" : "pending",
    reason: active ? null : reason,
  };
}
