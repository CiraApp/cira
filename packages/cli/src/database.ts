import { api, ApiError } from "./api.js";
import { readConfig } from "./config.js";
import { readProjectLink } from "./project.js";
import { dim, fail, info } from "./ui.js";
import type { Prompt } from "./confirm.js";

interface DatabaseResponse {
  envName: string;
  pooled: string;
  direct: string;
}

/**
 * `cira database url`: where this app's database is, for a person.
 *
 * Printed alone on standard output, so it can be handed straight to a tool -
 * `psql "$(cira database url)"`, or `pg_dump` to take the data away. Direct
 * rather than pooled by default, because that is what those tools need; the
 * app itself runs on the pooled one Cira set.
 */
export async function database(argv: string[] = []): Promise<number> {
  const [sub] = argv;
  if (sub !== "url") {
    fail(
      sub === undefined
        ? "Say what you want: cira database url"
        : `Unknown: database ${sub}`,
    );
    info("");
    info(`  ${dim("cira database url")}            the address, for psql or pg_dump`);
    info(`  ${dim("cira database url --pooled")}   the one the app runs on`);
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
    if (arg !== "--pooled") {
      fail(`cira database url does not understand ${arg}.`);
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
    info(`  ${dim("Name it instead:")} cira database url --space acme --app ledger`);
    info("");
    return 1;
  }

  let found: DatabaseResponse;
  try {
    found = await api<DatabaseResponse>(`/api/cli/database?${query}`);
  } catch (error) {
    fail(error instanceof ApiError ? error.message : "Could not ask Cira.");
    return 1;
  }

  // The address alone on stdout; nothing else may share it.
  process.stdout.write(`${argv.includes("--pooled") ? found.pooled : found.direct}\n`);
  return 0;
}

function readFlag(argv: readonly string[], flag: string): string | null {
  const at = argv.indexOf(flag);
  return at === -1 ? null : (argv[at + 1] ?? null);
}

/** Names apps read a Postgres address from, in the order they are common. */
export const DATABASE_NAMES: readonly string[] = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRESQL_URL",
  "PG_URL",
  "DB_URL",
];

/**
 * Whether this deploy asks Cira for a database, and under which name.
 *
 * Offered when the code reads an address nobody has set, because that is the
 * moment a developer would otherwise go and sign up for a database somewhere.
 * `--database` asks outright, which is how a script says yes. Never offered
 * in a pipe or with `--yes`: making a database is not something to do because
 * nobody was there to say no.
 */
export async function chooseDatabase(args: {
  missing: readonly string[];
  supplied: ReadonlySet<string>;
  argv: readonly string[];
  io: Prompt;
}): Promise<{ envName: string | null } | { error: string }> {
  const wanted = args.missing.find((name) => DATABASE_NAMES.includes(name)) ?? null;

  if (args.argv.includes("--database")) {
    const envName = wanted ?? "DATABASE_URL";
    if (args.supplied.has(envName)) {
      return {
        error: `This deploy sets ${envName} itself. Leave it out to use a database Cira makes, or deploy without --database.`,
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

  info(`  Cira can make a Postgres database for this app and set it as ${wanted}.`);
  const answer = (await args.io.ask("  Make one? [Y/n] ", false)).trim().toLowerCase();
  info("");
  return { envName: answer === "" || answer === "y" || answer === "yes" ? wanted : null };
}
