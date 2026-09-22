import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isPublicEnvName } from "@cira/deploy/packaging";

/**
 * The variables a deploy sets, gathered from the developer's machine.
 *
 * Cira stores none of this - it is read here, sent with the deploy, handed to
 * the provider and forgotten. See docs/secrets.md. A deploy sets what it
 * sends and leaves every other variable as it is in production, so this is a
 * change, not the whole environment: a machine with no `.env` at all changes
 * nothing. Taking a variable away is `--unset NAME`.
 */

/**
 * Layered in this order, each overriding the one before, which is how Next.js,
 * Vite and dotenv-flow read them for a production build: shared defaults in
 * `.env`, production's in `.env.production`, and a machine's own overrides in
 * the `.local` files. Reading only the first one that existed used to drop
 * everything in `.env` whenever a `.env.local` was present.
 */
const LAYERS = [".env", ".env.production", ".env.local", ".env.production.local"];

export interface Collected {
  env: Record<string, string>;
  /** Names to take away from the app in production. */
  unset: string[];
  /** Where the values came from, for the line the CLI prints. */
  source: string | null;
  /**
   * The file a value typed at the prompt is kept in: the most specific one
   * that was read, or null when none was, in which case it is used once.
   */
  file: string | null;
  /** Names the build will inline into the browser bundle. */
  publicNames: string[];
}

/**
 * Parse a dotenv file, the way the common loaders do.
 *
 * `KEY=value` and `export KEY=value`; comments and blank lines; a value in
 * double quotes may span lines and understands `\n`, which is how a private
 * key is written into one; single quotes are taken literally; and an unquoted
 * value ends at ` #`, so a trailing comment is not deployed as part of it.
 */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? "").trim();
    if (line === "" || line.startsWith("#")) continue;

    const withoutExport = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = withoutExport.indexOf("=");
    if (eq <= 0) continue;

    const key = withoutExport.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = withoutExport.slice(eq + 1).trimStart();
    const quote = value[0];

    if (quote === '"' || quote === "'" || quote === "`") {
      // Everything up to the matching quote, however many lines that takes.
      let body = value.slice(1);
      let close = closingQuote(body, quote);
      while (close === -1 && i + 1 < lines.length) {
        i += 1;
        body += `\n${lines[i] ?? ""}`;
        close = closingQuote(body, quote);
      }
      if (close === -1) {
        // Never closed: take the line as written rather than swallow the file.
        out[key] = value;
        continue;
      }
      value = body.slice(0, close);
      if (quote === '"') {
        value = value.replace(/\\(n|r|t|"|\\)/g, (_, c: string) =>
          c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c,
        );
      }
      out[key] = value;
      continue;
    }

    // An unquoted value ends where a comment starts.
    const comment = value.search(/\s#/);
    if (comment !== -1) value = value.slice(0, comment);
    out[key] = value.trimEnd();
  }

  return out;
}

function closingQuote(body: string, quote: string): number {
  for (let at = 0; at < body.length; at += 1) {
    if (body[at] === "\\" && quote === '"') {
      at += 1;
      continue;
    }
    if (body[at] === quote) return at;
  }
  return -1;
}

export function isPublicName(key: string): boolean {
  return isPublicEnvName(key);
}

/**
 * What this deploy changes.
 *
 * `--env-file` names the one file to read instead of the layers; `--env
 * KEY=value` sets one variable and wins over any file; `--unset NAME` takes a
 * variable away; `--no-env` reads no files and sends no values, which leaves
 * production's variables exactly as they are.
 */
export function collectEnv(root: string, argv: readonly string[]): Collected {
  const unset = flagValues(argv, "--unset");

  if (argv.includes("--no-env")) {
    return { env: {}, unset, source: null, file: null, publicNames: [] };
  }

  const env: Record<string, string> = {};
  const sources: string[] = [];

  const fileFlag = flagValues(argv, "--env-file")[0] ?? null;
  if (fileFlag !== null) {
    const path = fileFlag.startsWith("/") ? fileFlag : join(root, fileFlag);
    if (!existsSync(path)) {
      throw new Error(`No such env file: ${fileFlag}`);
    }
    Object.assign(env, parseDotenv(readFileSync(path, "utf8")));
    sources.push(fileFlag);
  } else {
    for (const name of LAYERS) {
      const path = join(root, name);
      if (!existsSync(path)) continue;
      Object.assign(env, parseDotenv(readFileSync(path, "utf8")));
      sources.push(name);
    }
  }

  // Explicit pairs last, so `--env KEY=value` overrides whatever a file said.
  let explicit = false;
  for (const pair of flagValues(argv, "--env")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    env[pair.slice(0, eq)] = pair.slice(eq + 1);
    explicit = true;
  }
  if (explicit) sources.push("--env");

  const files = sources.filter((name) => name !== "--env");
  return {
    env,
    unset: unset.filter((name) => !(name in env)),
    source: sources.length === 0 ? null : sources.join(", "),
    file: files[files.length - 1] ?? null,
    publicNames: Object.keys(env).filter(isPublicName).sort(),
  };
}

/** Every value given for a flag, as `--flag value` or `--flag=value`. */
function flagValues(argv: readonly string[], flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === flag) {
      const next = argv[i + 1];
      if (next !== undefined) values.push(next);
      i += 1;
    } else if (arg !== undefined && arg.startsWith(`${flag}=`)) {
      values.push(arg.slice(flag.length + 1));
    }
  }
  return values;
}
