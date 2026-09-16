/* eslint-disable no-console */
import { createDatabase } from "../client.js";
import { removeDemoOrg, seedDemoOrg, DEMO_SPACE } from "./demo-org.js";

/**
 * Build (or remove) the synthetic company.
 *
 *     pnpm --filter @cira/db db:seed:demo -- --owner you@example.com
 *     pnpm --filter @cira/db db:seed:demo -- --owner you@example.com --also them@example.com
 *     pnpm --filter @cira/db db:seed:demo -- --remove
 *
 * Writes over the direct connection rather than the pooled one, for the same
 * reason migrations do: this is a long burst of statements, not a request.
 */

try {
  process.loadEnvFile(new URL("../../../../.env.local", import.meta.url).pathname);
} catch {
  // No local env file; whatever is already in the environment stands.
}

const args = process.argv.slice(2);

function flag(name: string): string | undefined {
  const at = args.indexOf(`--${name}`);
  if (at !== -1 && args[at + 1] !== undefined) return args[at + 1];
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  return inline?.slice(name.length + 3);
}

const url = process.env["DATABASE_URL_UNPOOLED"] ?? process.env["DATABASE_URL"];
if (url === undefined || url === "") {
  console.error("Set DATABASE_URL_UNPOOLED (preferred) or DATABASE_URL.");
  process.exit(1);
}

const database = createDatabase(url);

if (args.includes("--remove")) {
  await removeDemoOrg(database);
  console.log(`Removed the ${DEMO_SPACE.name} demo space and its accounts.`);
  process.exit(0);
}

const ownerEmail = flag("owner");
if (ownerEmail === undefined) {
  console.error(
    "Pass --owner <email>: the Cira account that should own the demo company.\n" +
      "It has to have signed in at least once, so that Cira knows who it is.",
  );
  process.exit(1);
}

const origin =
  flag("origin") ?? process.env["CIRA_APP_URL"] ?? "https://cira-aumitshiv.vercel.app";

try {
  const alsoEmails = (flag("also") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");

  const result = await seedDemoOrg(database, { ownerEmail, alsoEmails, origin });
  console.log(
    [
      `${DEMO_SPACE.name} is ready at /${result.spaceSlug}`,
      ``,
      `  owner         ${result.ownerName}`,
      `  people        ${result.people}`,
      `  teams         ${result.teams}`,
      `  apps          ${result.apps}`,
      `  capabilities  ${result.capabilities} (${result.enabledCapabilities} live, the rest awaiting review)`,
      `  grants        ${result.grants}`,
      ``,
      `Remove it again with --remove.`,
    ].join("\n"),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
