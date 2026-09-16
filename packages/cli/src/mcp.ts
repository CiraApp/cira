import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { readConfig } from "./config.js";
import { bold, dim, fail, info, success } from "./ui.js";

/**
 * Point this machine's assistants at Cira.
 *
 * The credential is the one `cira login` already stored, not a fresh one: an
 * agent acting for you should be the same principal as the terminal acting for
 * you, and one token per machine means `cira mcp disconnect` and a revoke in
 * the app both cut the same thing off. That is also why nothing here talks to
 * the server - the token is already on disk, and the endpoint is derived from
 * the host it was issued by.
 */

const SERVER_NAME = "cira";

interface Target {
  id: string;
  name: string;
  /** Where its configuration lives, for the line printed beside it. */
  where: string;
  detect: () => boolean;
  connect: (endpoint: string, token: string) => void;
  disconnect: () => void;
}

function home(): string {
  return process.env["HOME"] ?? homedir();
}

function onPath(binary: string): boolean {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [binary], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Claude Code is configured through its own CLI rather than by editing
 * `~/.claude.json`: that file is Claude Code's to own, and `claude mcp add` is
 * the documented way in, so it keeps working when the shape behind it changes.
 *
 * Explicitly `--scope user`. The default is `local`, which files the server
 * under the directory the command happened to be run from - so connecting from
 * one repository would leave the assistant unable to see Cira in any other.
 * The credential is the machine's, so the configuration should be too.
 */
function claudeCode(): Target {
  const dir = process.env["CLAUDE_CONFIG_DIR"] ?? join(home(), ".claude");

  return {
    id: "claude-code",
    name: "Claude Code",
    where: "claude mcp add",
    detect: () => onPath("claude") && (existsSync(dir) || true),
    connect: (endpoint, token) => {
      // Replacing rather than erroring on a second run: connecting twice is a
      // thing people do, and it should mean "make it right", not "fail".
      try {
        execFileSync("claude", ["mcp", "remove", "--scope", "user", SERVER_NAME], {
          stdio: "ignore",
        });
      } catch {
        // Not there yet, which is the normal case.
      }
      execFileSync(
        "claude",
        [
          "mcp",
          "add",
          "--scope",
          "user",
          "--transport",
          "http",
          SERVER_NAME,
          endpoint,
          "--header",
          `Authorization: Bearer ${token}`,
        ],
        { stdio: "ignore" },
      );
    },
    disconnect: () => {
      try {
        execFileSync("claude", ["mcp", "remove", "--scope", "user", SERVER_NAME], {
          stdio: "ignore",
        });
      } catch {
        // Already gone is the outcome we wanted.
      }
    },
  };
}

/** Cursor keeps remote servers in `~/.cursor/mcp.json`. */
function cursor(): Target {
  const path = join(home(), ".cursor", "mcp.json");

  const read = (): Record<string, unknown> => {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch {
      return {};
    }
  };

  const write = (config: Record<string, unknown>): void => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  };

  return {
    id: "cursor",
    name: "Cursor",
    where: path.replace(home(), "~"),
    detect: () => existsSync(join(home(), ".cursor")) || onPath("cursor"),
    connect: (endpoint, token) => {
      const config = read();
      // Merged, never overwritten: this file is usually not only ours.
      const servers = (config["mcpServers"] ?? {}) as Record<string, unknown>;
      servers[SERVER_NAME] = {
        url: endpoint,
        headers: { Authorization: `Bearer ${token}` },
      };
      config["mcpServers"] = servers;
      write(config);
    },
    disconnect: () => {
      const config = read();
      const servers = config["mcpServers"] as Record<string, unknown> | undefined;
      if (servers === undefined) return;
      delete servers[SERVER_NAME];
      write(config);
    },
  };
}

function targets(): Target[] {
  return [claudeCode(), cursor()];
}

/**
 * The agents Cira can install a Skill into but cannot yet configure for MCP.
 *
 * Named explicitly rather than passed over, because "Cira found Codex and said
 * nothing" reads as a bug. Their MCP configuration formats are not stable
 * enough to write blind, and a wrong config file is worse than a printed
 * instruction.
 */
const MANUAL: Array<{ name: string; probe: string }> = [
  { name: "Codex", probe: ".codex" },
  { name: "Gemini CLI", probe: ".gemini" },
  { name: "Pi", probe: ".pi" },
];

function endpointFor(apiUrl: string): string {
  return `${apiUrl.replace(/\/+$/, "")}/api/mcp`;
}

export function mcpConnect(): number {
  const config = readConfig();

  if (config.token === undefined) {
    fail("Not signed in. Run `cira login` first.");
    return 1;
  }

  const endpoint = endpointFor(config.apiUrl);

  info("");
  info(`  ${bold("Cira")}`);
  if (config.email !== undefined) info(`  Signed in as ${config.email}`);
  info(`  ${dim(endpoint)}`);
  info("");

  const found = targets().filter((target) => target.detect());

  if (found.length === 0) {
    fail("No assistants found that Cira can configure.");
    info(dim("  Looked for Claude Code and Cursor."));
    return 1;
  }

  for (const target of found) {
    try {
      target.connect(endpoint, config.token);
      success(`${target.name} ${dim(target.where)}`);
    } catch (error) {
      fail(`${target.name} - ${error instanceof Error ? error.message : "failed"}`);
    }
  }

  for (const manual of MANUAL) {
    if (existsSync(join(home(), manual.probe))) {
      info(
        dim(`  ${manual.name} found - add it from Cira, under Connect your assistant`),
      );
    }
  }

  info("");
  info(`  Ask your assistant: ${bold('"what can I do at my company?"')}`);
  info(dim("  Disconnect with `cira mcp disconnect`."));
  info("");
  return 0;
}

export function mcpDisconnect(): number {
  for (const target of targets()) {
    if (!target.detect()) continue;
    try {
      target.disconnect();
      success(`${target.name} disconnected`);
    } catch {
      fail(`${target.name} - could not update its configuration`);
    }
  }

  info(dim("  The token itself is still valid. Revoke it in Cira, or `cira logout`."));
  return 0;
}

export function mcpCommand(args: string[]): number {
  switch (args[0]) {
    case "connect":
      return mcpConnect();
    case "disconnect":
      return mcpDisconnect();
    default:
      fail("Usage: cira mcp connect | cira mcp disconnect");
      return 1;
  }
}
