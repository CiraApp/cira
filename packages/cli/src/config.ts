import { homedir } from "node:os";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Where the CLI keeps its credential.
 *
 * Under the user's home rather than the project, so a token is never committed
 * by accident, and written 0600 because it is a bearer credential: anything
 * that can read the file can act as that person.
 */
export interface CliConfig {
  apiUrl: string;
  token?: string;
  email?: string;
}

export const DEFAULT_API_URL = "https://cira.dev";

/**
 * Where Cira answered before it had a name.
 *
 * Still live, and tokens issued against it still work, because it is the same
 * deployment either way. Anyone whose config points here is moved across on
 * their next command rather than being left on a hostname that reads like
 * somebody's scratch project. Only this exact value is rewritten - a URL
 * someone set deliberately, to a preview or a local instance, is theirs.
 */
const PREVIOUS_API_URL = "https://cira-aumitshiv.vercel.app";

/** Everything Cira keeps on this machine lives here. */
export function ciraHome(): string {
  return process.env["CIRA_HOME"] ?? join(homedir(), ".cira");
}

function configPath(): string {
  return join(ciraHome(), "config.json");
}

export function readConfig(): CliConfig {
  const apiUrl = process.env["CIRA_API_URL"] ?? DEFAULT_API_URL;

  try {
    const raw = JSON.parse(readFileSync(configPath(), "utf8")) as Partial<CliConfig>;
    return {
      // An explicit environment override always wins over the stored value.
      apiUrl:
        process.env["CIRA_API_URL"] ??
        (raw.apiUrl === PREVIOUS_API_URL ? DEFAULT_API_URL : raw.apiUrl) ??
        DEFAULT_API_URL,
      ...(raw.token !== undefined ? { token: raw.token } : {}),
      ...(raw.email !== undefined ? { email: raw.email } : {}),
    };
  } catch {
    return { apiUrl };
  }
}

export function writeConfig(config: CliConfig): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function clearConfig(): void {
  try {
    rmSync(configPath());
  } catch {
    // Already gone is the outcome we wanted.
  }
}
