#!/usr/bin/env node
import { api, ApiError } from "./api.js";
import { clearConfig, readConfig } from "./config.js";
import { login } from "./login.js";
import { detectFramework, readProjectLink } from "./project.js";
import { bold, dim, fail, info, success } from "./ui.js";

const USAGE = `
  ${bold("cira")} - deploy software to your company

  ${bold("Commands")}
    login      Connect this machine to your Cira account
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

  switch (command) {
    case "login":
      return login();
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

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    fail(error instanceof Error ? error.message : "Something went wrong.");
    process.exitCode = 1;
  });
