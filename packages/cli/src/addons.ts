import { api, ApiError } from "./api.js";
import { readConfig } from "./config.js";
import { readProjectLink } from "./project.js";
import { dim, fail, info } from "./ui.js";
import type { Prompt } from "./confirm.js";

/**
 * What Cira can make an app besides running it: a Postgres database and a
 * Redis cache, each the app's own. Asked for when deploying, and read back
 * with `cira database url` and `cira cache url`.
 */
export type AddonKind = "database" | "cache";

interface Addon {
  /** The flag that asks for one outright. */
  flag: string;
  /** What it is, in the offer. */
  what: string;
  /** Names apps read its address from, most common first. */
  names: readonly string[];
  /** What `url` is for, in the help. */
  urlFor: string;
}

export const ADDONS: Record<AddonKind, Addon> = {
  database: {
    flag: "--database",
    what: "a Postgres database",
    names: ["DATABASE_URL", "POSTGRES_URL", "POSTGRESQL_URL", "PG_URL", "DB_URL"],
    urlFor: "for psql or pg_dump",
  },
  cache: {
    flag: "--cache",
    what: "a Redis cache",
    names: ["REDIS_URL", "REDIS_TLS_URL", "KV_URL", "CACHE_URL", "UPSTASH_REDIS_URL"],
    urlFor: "for redis-cli",
  },
};

interface UrlResponse {
  envName: string;
  /** A database: through the pooler, and straight to Postgres. */
  pooled?: string;
  direct?: string;
  /** A cache. */
  url?: string;
}

/**
 * `cira database url` and `cira cache url`: where this app's database or
 * cache is, for a person.
 *
 * Printed alone on standard output, so it can be handed straight to a tool -
 * `psql "$(cira database url)"`, or `pg_dump` to take the data away. A
 * database's direct address by default, because that is what those tools
 * need; the app itself runs on the pooled one Cira set.
 */
export async function addonCommand(
  kind: AddonKind,
  argv: string[] = [],
): Promise<number> {
  const [sub] = argv;
  const name = kind === "database" ? "database" : "cache";
  if (sub !== "url") {
    fail(
      sub === undefined
        ? `Say what you want: cira ${name} url`
        : `Unknown: ${name} ${sub}`,
    );
    info("");
    info(`  ${dim(`cira ${name} url`)}            the address, ${ADDONS[kind].urlFor}`);
    if (kind === "database") {
      info(`  ${dim("cira database url --pooled")}   the one the app runs on`);
    }
    info("");
    return 1;
  }

  // Nothing else is understood, and a typo must not print a password for the
  // wrong app.
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--space" || arg === "--app") {
      i += 1;
      continue;
    }
    if (!(kind === "database" && arg === "--pooled")) {
      fail(`cira ${name} url does not understand ${arg}.`);
      return 1;
    }
  }

  const config = readConfig();
  if (config.token === undefined) {
    fail("Not signed in. Run: cira login");
    return 1;
  }

  const link = readProjectLink(process.cwd());
  const spaceSlug = readFlag(argv, "--space");
  const appSlug = readFlag(argv, "--app");
  const query =
    spaceSlug !== null && appSlug !== null
      ? new URLSearchParams({ space: spaceSlug, app: appSlug })
      : link !== null
        ? new URLSearchParams({ appId: link.appId })
        : null;
  if (query === null) {
    fail("This folder is not linked to a Cira app.");
    info("");
    info(`  ${dim("Name it instead:")} cira ${name} url --space acme --app ledger`);
    info("");
    return 1;
  }

  let found: UrlResponse;
  try {
    found = await api<UrlResponse>(`/api/cli/${name}?${query}`);
  } catch (error) {
    fail(error instanceof ApiError ? error.message : "Could not ask Cira.");
    return 1;
  }

  // The address alone on stdout; nothing else may share it.
  const address =
    kind === "cache"
      ? found.url
      : argv.includes("--pooled")
        ? found.pooled
        : found.direct;
  process.stdout.write(`${address ?? ""}\n`);
  return 0;
}

function readFlag(argv: readonly string[], flag: string): string | null {
  const at = argv.indexOf(flag);
  return at === -1 ? null : (argv[at + 1] ?? null);
}

/**
 * Whether this deploy asks Cira for a database or a cache, and under which
 * name.
 *
 * Offered when the code reads an address nobody has set, because that is the
 * moment a developer would otherwise go and sign up for one somewhere. The
 * flag asks outright, which is how a script says yes. Never offered in a pipe
 * or with `--yes`: making one is not something to do because nobody was
 * there to say no.
 */
export async function chooseAddon(args: {
  kind: AddonKind;
  missing: readonly string[];
  supplied: ReadonlySet<string>;
  argv: readonly string[];
  io: Prompt;
}): Promise<{ envName: string | null } | { error: string }> {
  const addon = ADDONS[args.kind];
  const wanted = args.missing.find((name) => addon.names.includes(name)) ?? null;

  if (args.argv.includes(addon.flag)) {
    const envName = wanted ?? addon.names[0]!;
    if (args.supplied.has(envName)) {
      return {
        error: `This deploy sets ${envName} itself. Leave it out to use ${addon.what} Cira makes, or deploy without ${addon.flag}.`,
      };
    }
    return { envName };
  }

  if (
    wanted === null ||
    !args.io.interactive ||
    args.argv.includes("--yes") ||
    args.argv.includes("-y")
  ) {
    return { envName: null };
  }

  info("");
  info(`  The code reads ${wanted}, and nothing sets it.`);
  info(`  Cira can make this app ${addon.what} of its own and set it.`);
  const answer = (await args.io.ask("  Make one? [Y/n] ", false)).trim().toLowerCase();
  info("");
  return { envName: answer === "" || answer === "y" || answer === "yes" ? wanted : null };
}
