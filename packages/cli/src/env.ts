import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The environment an app needs, gathered from the developer's machine.
 *
 * Cira stores none of this - it is read here, sent with the deploy, handed to
 * the provider and forgotten. See docs/secrets.md. The only thing this module
 * owes the rest of the CLI is a map, and a list of names safe to print.
 */

/** Read in order; the first file that exists wins, the rest are ignored. */
const CANDIDATES = [".env.production.local", ".env.local", ".env.production", ".env"];

export interface Collected {
  env: Record<string, string>;
  /** The file it came from, for the line the CLI prints. */
  source: string | null;
  /** Names the build will inline into the browser bundle. */
  publicNames: string[];
}

/**
 * Parse a dotenv file.
 *
 * Deliberately small: `KEY=value`, `export KEY=value`, comments, blank lines,
 * and quotes stripped when they wrap the whole value. Not a dotenv
 * implementation - a file needing more than this is a file worth being explicit
 * about with `--env`.
 */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;

    const withoutExport = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = withoutExport.indexOf("=");
    if (eq <= 0) continue;

    const key = withoutExport.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = withoutExport.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2);
    if (quoted) value = value.slice(1, -1);

    out[key] = value;
  }

  return out;
}

export function isPublicName(key: string): boolean {
  return key.startsWith("NEXT_PUBLIC_");
}

/**
 * What to deploy with.
 *
 * `--env-file` and `--env` are explicit and always win; otherwise the first
 * dotenv file that exists is used. `--no-env` sends nothing, which is how a
 * developer clears variables an app no longer needs.
 */
export function collectEnv(root: string, argv: readonly string[]): Collected {
  if (argv.includes("--no-env")) {
    return { env: {}, source: null, publicNames: [] };
  }

  const env: Record<string, string> = {};
  let source: string | null = null;

  const fileFlag = flagValue(argv, "--env-file");
  if (fileFlag !== null) {
    const path = fileFlag.startsWith("/") ? fileFlag : join(root, fileFlag);
    if (!existsSync(path)) {
      throw new Error(`No such env file: ${fileFlag}`);
    }
    Object.assign(env, parseDotenv(readFileSync(path, "utf8")));
    source = fileFlag;
  } else {
    for (const name of CANDIDATES) {
      const path = join(root, name);
      if (!existsSync(path)) continue;
      Object.assign(env, parseDotenv(readFileSync(path, "utf8")));
      source = name;
      break;
    }
  }

  // Explicit pairs last, so `--env KEY=value` overrides whatever a file said.
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== "--env") continue;
    const pair = argv[i + 1];
    if (pair === undefined) continue;
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    env[pair.slice(0, eq)] = pair.slice(eq + 1);
    if (source === null) source = "--env";
  }

  return {
    env,
    source,
    publicNames: Object.keys(env).filter(isPublicName).sort(),
  };
}

function flagValue(argv: readonly string[], flag: string): string | null {
  const at = argv.indexOf(flag);
  if (at === -1) return null;
  return argv[at + 1] ?? null;
}
