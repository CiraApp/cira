#!/usr/bin/env node
import { api, ApiError } from "./api.js";
import { clearConfig, readConfig } from "./config.js";
import { deploy } from "./deploy.js";
import { remove } from "./remove.js";
import { addonCommand } from "./addons.js";
import { login } from "./login.js";
import { mcpCommand } from "./mcp.js";
import { skillCommand } from "./skill/command.js";
import { beginUpdateCheck, finishUpdateCheck, updateCommand } from "./update/index.js";
import { detectFramework, readProjectLink } from "./project.js";
import { bold, dim, fail, info, success } from "./ui.js";
import { unknownArgument } from "./args.js";

const USAGE = `
  ${bold("cira")} - deploy software to your company

  ${bold("Commands")}
    deploy     Deploy this folder to your company
               --space <slug>   which space, when you are in more than one
               --env-file <p>   read variables from this file instead of .env files
               --env K=V        set one variable (repeatable, wins over a file)
               --unset NAME     take a variable away from the app (repeatable)
               --no-env         send no variables; production keeps its own
               --dockerfile <p>  build with this Dockerfile, for a monorepo
                                 where it sits apart from the workspace root
               --database       give the app a Postgres database, made by Cira,
                                as DATABASE_URL (or the name its code reads)
               --cache          give the app a Redis cache, made by Cira,
                                as REDIS_URL (or the name its code reads)
               --yes            deploy without asking about missing variables
               A deploy only changes the variables it sends. Everything else
               stays as it is in production.
    remove     Take this folder's app down and delete what it left behind
               --space <slug>   which space, when the folder is not linked
               --app <slug>     which app, when the folder is not linked
               --confirm <name> the app's name, to remove without being asked
    database   url        Print the app's database address, for psql or pg_dump
               --pooled   the address the app itself runs on
    cache      url        Print the app's cache address, for redis-cli
    login      Connect this machine to your Cira account
    skill      install    Add the Cira Skill to your coding agents
    mcp        connect    Point this machine's assistants at your company
               disconnect Stop them reaching it
    update     Update Cira and the Skill copies you approved
    logout     Forget the stored credential
    whoami     Show who you are signed in as
    status     Show what this folder is linked to

  ${bold("Environment")}
    CIRA_API_URL   Point at a different Cira (default: production)
    CIRA_HOME      Where the credential is stored (default: ~/.cira)
`;

interface MeResponse {
  user: { name: string; email: string };
  spaces: Array<{ slug: string; name: string; role: string }>;
}

async function whoami(): Promise<number> {
  const config = readConfig();
  if (config.token === undefined) {
    fail("Not signed in. Run: cira login");
    return 1;
  }

  try {
    const me = await api<MeResponse>("/api/cli/me");
    info(`${bold(me.user.name)} ${dim(`<${me.user.email}>`)}`);
    if (me.spaces.length === 0) {
      info(dim("  No spaces yet."));
    } else {
      for (const space of me.spaces) {
        info(`  ${space.name} ${dim(`(${space.role})`)}`);
      }
    }
    return 0;
  } catch (error) {
    fail(error instanceof ApiError ? error.message : "Could not reach Cira.");
    return 1;
  }
}

function status(): number {
  const framework = detectFramework();
  const link = readProjectLink();

  info(`${bold("Folder")}    ${process.cwd()}`);
  info(`${bold("Framework")} ${framework ?? dim("not a supported project")}`);
  info(
    link === null
      ? `${bold("Linked")}    ${dim("not linked to an app yet")}`
      : `${bold("Linked")}    ${link.spaceSlug}/${link.appSlug}`,
  );
  return 0;
}

async function main(): Promise<number> {
  const command = process.argv[2];
  const rest = process.argv.slice(3);

  if (rest.includes("--help") || rest.includes("-h")) {
    info(USAGE);
    return 0;
  }
  const stray = command === undefined ? null : unknownArgument(command, rest);
  if (stray !== null) {
    fail(`cira ${command} does not understand ${stray}. Nothing was changed.`);
    info(dim("  See: cira --help"));
    return 1;
  }

  switch (command) {
    case "deploy":
      return deploy(process.argv.slice(3));
    // Only `remove`, deliberately. `undeploy` reads as the opposite of
    // `deploy` and would be a reasonable name for stopping a running app while
    // keeping what Cira knows about it - a different operation, and one worth
    // leaving the word free for.
    case "remove":
      return remove(process.argv.slice(3));
    case "database":
      return addonCommand("database", process.argv.slice(3));
    case "cache":
      return addonCommand("cache", process.argv.slice(3));
    case "login":
      return login();
    case "skill":
      return skillCommand(process.argv.slice(3));
    case "mcp":
      return mcpCommand(process.argv.slice(3));
    case "update":
      return updateCommand();
    case "logout":
      clearConfig();
      success("Signed out.");
      return 0;
    case "whoami":
      return whoami();
    case "status":
      return status();
    case undefined:
    case "help":
    case "--help":
    case "-h":
      info(USAGE);
      return 0;
    default:
      fail(`Unknown command: ${command}`);
      info(USAGE);
      return 1;
  }
}

/**
 * The update check runs alongside the command, never in front of it.
 *
 * Started before the work and read after it, with a short grace period: the
 * check either finished while the command ran or it is abandoned. `cira
 * update` does its own fresh check, so it is left out of this one entirely.
 */
const passive = process.argv[2] === "update" ? null : beginUpdateCheck();

main()
  .then(async (code) => {
    process.exitCode = code;
    if (passive !== null) await finishUpdateCheck(passive);
  })
  .catch(async (error: unknown) => {
    fail(error instanceof Error ? error.message : "Something went wrong.");
    process.exitCode = 1;
    if (passive !== null) await finishUpdateCheck(passive);
  });
