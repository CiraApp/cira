import { ExternalAccountClient } from "google-auth-library";
import { getVercelOidcToken } from "@vercel/oidc";

/**
 * Talking to Google as Cira, and to a Cira app as Cira.
 *
 * No key. Google's default policy on new projects refuses service account key
 * creation, and that push is in the right direction: a key is a long-lived
 * secret that has to be stored, rotated and kept out of logs forever. Instead
 * Vercel issues every deployment a short-lived OIDC token, Google is
 * configured to trust that issuer, and the token is exchanged for one that
 * works. Nothing long-lived exists, so there is nothing to leak - which is the
 * same argument docs/secrets.md makes about environment variables.
 *
 * Two different credentials for two different jobs, which is the part worth
 * keeping straight:
 *
 * - An **access token** authorises Cira against Google's own APIs - Cloud
 *   Build, Cloud Run, Storage. It says "this deployment may deploy".
 * - An **identity token** authorises Cira against one deployed app. Cloud Run
 *   checks its audience and refuses everyone else, which is what makes an app
 *   unreachable except through Cira.
 *
 * The second replaced Vercel's protection-bypass secret, and is better in one
 * specific way: minted per request and expiring, rather than a long-lived
 * value in a database column, which is where that secret used to be kept.
 */

export interface FederationConfig {
  projectNumber: string;
  serviceAccountEmail: string;
  /** The Workload Identity Pool, `vercel` unless someone renamed it. */
  poolId: string;
  providerId: string;
}

const STS_URL = "https://sts.googleapis.com/v1/token";
const CLOUD_PLATFORM = "https://www.googleapis.com/auth/cloud-platform";

/** What Google knows this pool's provider as. */
export function audienceFor(config: FederationConfig): string {
  return (
    `//iam.googleapis.com/projects/${config.projectNumber}` +
    `/locations/global/workloadIdentityPools/${config.poolId}` +
    `/providers/${config.providerId}`
  );
}

/**
 * The principal a Vercel deployment presents itself as.
 *
 * Exported because it is the value that has to match a binding on the service
 * account exactly, and a mismatch fails as a flat permission denial with
 * nothing naming the subject. Being able to print the expected one turns that
 * into a diff.
 */
export function subjectFor(args: {
  team: string;
  project: string;
  environment: "production" | "preview" | "development";
}): string {
  return `owner:${args.team}:project:${args.project}:environment:${args.environment}`;
}

interface Cached {
  token: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export class GoogleTokens {
  private readonly client;
  private readonly cache = new Map<string, Cached>();

  constructor(private readonly config: FederationConfig) {
    const client = ExternalAccountClient.fromJSON({
      type: "external_account",
      audience: audienceFor(config),
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      token_url: STS_URL,
      service_account_impersonation_url:
        `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/` +
        `${config.serviceAccountEmail}:generateAccessToken`,
      subject_token_supplier: {
        // Vercel mints this per deployment and it expires on its own. Locally
        // it arrives through `vercel env pull`, so `next dev` can deploy too.
        getSubjectToken: () => getVercelOidcToken(),
      },
    });

    if (client === null) {
      throw new Error("Could not build a Google federated credential.");
    }
    this.client = client;
  }

  /** For Google's own APIs. */
  async accessToken(): Promise<string> {
    const held = this.cache.get("access");
    // Sixty seconds of headroom: a token that expires in flight fails the
    // request it was fetched for.
    if (held !== undefined && held.expiresAt > Date.now() + 60_000) return held.token;

    this.client.scopes = [CLOUD_PLATFORM];
    const { token, res } = await this.client.getAccessToken();
    if (typeof token !== "string" || token === "") {
      throw new Error("Google returned no usable access token.");
    }

    const lifetime = readLifetime(res) ?? 3600;
    this.cache.set("access", { token, expiresAt: Date.now() + lifetime * 1000 });
    return token;
  }

  /**
   * For one deployed app.
   *
   * The audience is the service's own URL, so a token minted for one app is
   * rejected by every other - which is the whole of Cira's access model on
   * Cloud Run. Impersonation is done explicitly rather than through the
   * client's ID-token helper, because that helper wants its own audience at
   * construction time and this needs a different one per app.
   */
  async identityToken(serviceUrl: string): Promise<string> {
    const key = `id:${serviceUrl}`;
    const held = this.cache.get(key);
    if (held !== undefined && held.expiresAt > Date.now() + 60_000) return held.token;

    const access = await this.accessToken();
    const response = await fetch(
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/` +
        `${encodeURIComponent(this.config.serviceAccountEmail)}:generateIdToken`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${access}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ audience: serviceUrl, includeEmail: true }),
      },
    );

    if (!response.ok) {
      // Google's body can echo the assertion, so it is not passed through.
      throw new Error(`Google refused an identity token (${response.status}).`);
    }

    const body = (await response.json()) as { token?: unknown };
    if (typeof body.token !== "string") {
      throw new Error("Google returned no usable identity token.");
    }

    // Identity tokens are an hour; the cache is trimmed short of that.
    this.cache.set(key, { token: body.token, expiresAt: Date.now() + 3600 * 1000 });
    return body.token;
  }
}

function readLifetime(res: unknown): number | null {
  if (typeof res !== "object" || res === null) return null;
  const data = (res as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const expires = (data as { expires_in?: unknown }).expires_in;
  return typeof expires === "number" ? expires : null;
}
