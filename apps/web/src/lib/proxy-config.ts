import "server-only";

/**
 * Where deployed apps are served from, and what signs the tokens that open
 * them.
 *
 * Separate from the Google settings because it is a different question: those
 * say where apps run, these say how a person reaches one.
 */

export interface ProxyConfig {
  /** Apps answer at `{app}--{space}.{appsDomain}`. */
  appsDomain: string;
  /** Shared with the proxy, which only ever verifies with it. */
  secret: string;
}

export function proxyConfig(
  env: Record<string, string | undefined> = process.env,
): ProxyConfig {
  const appsDomain = env["CIRA_APPS_DOMAIN"]?.trim();
  const secret = env["CIRA_PROXY_SECRET"]?.trim();

  const missing: string[] = [];
  if (appsDomain === undefined || appsDomain === "") missing.push("CIRA_APPS_DOMAIN");
  if (secret === undefined || secret === "") missing.push("CIRA_PROXY_SECRET");

  if (missing.length > 0 || appsDomain === undefined || secret === undefined) {
    throw new Error(`Opening apps is not configured. Set ${missing.join(", ")}.`);
  }

  return { appsDomain, secret };
}

/** Whether apps can be opened at all, for a page deciding what to offer. */
export function browserAccessConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  try {
    proxyConfig(env);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a request carries the secret only the app proxy holds. Compared in
 * constant time: a comparison that returns early tells whoever is guessing
 * how much of their guess was right. Length is not hidden, and does not need
 * to be - the secret's length is not the secret.
 */
export function fromProxy(request: Request, config: ProxyConfig): boolean {
  const presented = request.headers.get("x-cira-proxy-secret") ?? "";
  const expected = config.secret;
  if (presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < presented.length; i += 1) {
    diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
