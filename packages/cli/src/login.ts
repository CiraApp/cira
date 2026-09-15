import { hostname } from "node:os";
import { api, ApiError } from "./api.js";
import { readConfig, writeConfig } from "./config.js";
import { offerSkill } from "./skill/command.js";
import { bold, dim, fail, info, success } from "./ui.js";

interface StartResponse {
  deviceCode: string;
  userCode: string;
  verifyPath: string;
  expiresInSeconds: number;
  intervalSeconds: number;
}

interface PollResponse {
  status: "pending" | "approved" | "expired" | "claimed" | "invalid";
  token?: string;
  user?: { name: string; email: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sign in by approving this terminal in a browser.
 *
 * A device code rather than a local callback server, so it works the same over
 * SSH, in a container, and on a laptop.
 */
export async function login(): Promise<number> {
  const config = readConfig();

  let start: StartResponse;
  try {
    start = await api<StartResponse>("/api/cli/auth/start", {
      method: "POST",
      body: { label: `${hostname()} CLI` },
    });
  } catch (error) {
    fail(error instanceof ApiError ? error.message : "Could not start sign-in.");
    return 1;
  }

  const url = `${config.apiUrl}${start.verifyPath}?code=${start.userCode}`;

  info("");
  info(`  Open ${bold(url)}`);
  info(`  and confirm this code: ${bold(start.userCode)}`);
  info("");
  info(dim("  Waiting for you to approve..."));

  const deadline = Date.now() + start.expiresInSeconds * 1000;

  while (Date.now() < deadline) {
    await sleep(start.intervalSeconds * 1000);

    let poll: PollResponse;
    try {
      poll = await api<PollResponse>("/api/cli/auth/poll", {
        method: "POST",
        body: { deviceCode: start.deviceCode },
      });
    } catch {
      // A blip while polling is not a failed login; keep waiting.
      continue;
    }

    if (poll.status === "approved" && poll.token !== undefined) {
      writeConfig({
        apiUrl: config.apiUrl,
        token: poll.token,
        ...(poll.user !== undefined ? { email: poll.user.email } : {}),
      });
      info("");
      success(`Signed in as ${poll.user?.email ?? "your account"}`);

      // Onboarding continues into the coding agents the developer already
      // uses. Offered here rather than as an install script, because the one
      // thing that must not happen is Cira quietly editing their tools.
      await offerSkill();
      return 0;
    }

    if (poll.status === "expired" || poll.status === "claimed") {
      info("");
      fail("That sign-in expired. Run cira login again.");
      return 1;
    }
  }

  info("");
  fail("Timed out waiting for approval. Run cira login again.");
  return 1;
}
