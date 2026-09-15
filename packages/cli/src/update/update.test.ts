import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalSkill } from "@cira/skill";
import type { SkillInstaller } from "../skill/index.js";
import { checkForUpdate, TTL_MS } from "./check.js";
import {
  beginUpdateCheck,
  finishUpdateCheck,
  syncInstalledSkills,
  updateCommand,
} from "./index.js";
import {
  readSkillState,
  readUpdateState,
  writeSkillState,
  writeUpdateState,
} from "./state.js";
import { currentVersion, isNewer } from "./version.js";

/**
 * The updater against a real CIRA_HOME in a temporary directory. Nothing here
 * reaches the network or npm: the registry lookup and the install command are
 * both injected, which is the whole reason they are parameters.
 */

let home: string;
const current = currentVersion();

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cira-update-"));
  process.env["CIRA_HOME"] = home;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env["CIRA_HOME"];
});

const says = (version: string | null) => () => Promise.resolve(version);
const hangsForever = () => new Promise<string | null>(() => undefined);
const later = "999.0.0";

describe("isNewer", () => {
  it("compares the three numbers in order", () => {
    expect(isNewer("0.2.0", "0.1.9")).toBe(true);
    expect(isNewer("1.0.0", "0.99.99")).toBe(true);
    expect(isNewer("0.1.0", "0.1.0")).toBe(false);
    expect(isNewer("0.1.0", "0.2.0")).toBe(false);
  });

  it("never offers a prerelease over the release of the same number", () => {
    expect(isNewer("1.0.0-beta.1", "1.0.0")).toBe(false);
    expect(isNewer("1.0.0", "1.0.0-beta.1")).toBe(true);
  });

  it("treats anything it cannot parse as not newer", () => {
    expect(isNewer("latest", "0.1.0")).toBe(false);
    expect(isNewer("", "0.1.0")).toBe(false);
  });
});

describe("checkForUpdate", () => {
  it("reports no update when the registry matches what is installed", async () => {
    const check = await checkForUpdate({ fetchLatest: says(current) });
    expect(check.hasUpdate).toBe(false);
  });

  it("reports an update when the registry is ahead", async () => {
    const check = await checkForUpdate({ fetchLatest: says(later) });
    expect(check).toMatchObject({ latest: later, hasUpdate: true });
  });

  it("does not ask again inside the cache window", async () => {
    const registry = vi.fn(says(later));
    await checkForUpdate({ fetchLatest: registry });
    await checkForUpdate({ fetchLatest: registry });

    expect(registry).toHaveBeenCalledTimes(1);
  });

  it("asks again once the window has passed", async () => {
    const registry = vi.fn(says(later));
    const now = Date.now();
    await checkForUpdate({ fetchLatest: registry, now });
    await checkForUpdate({ fetchLatest: registry, now: now + TTL_MS + 1 });

    expect(registry).toHaveBeenCalledTimes(2);
  });

  it("is forced past the cache by `cira update`", async () => {
    const registry = vi.fn(says(later));
    await checkForUpdate({ fetchLatest: registry });
    await checkForUpdate({ fetchLatest: registry, force: true });

    expect(registry).toHaveBeenCalledTimes(2);
  });

  it("fails silently when offline, and does not retry on every command", async () => {
    const registry = vi.fn(() => Promise.reject(new Error("ENOTFOUND")));

    // The rejection is the fetcher's own business; callers see "no answer".
    await expect(checkForUpdate({ fetchLatest: registry })).rejects.toThrow();

    const quiet = await checkForUpdate({ fetchLatest: says(null) });
    expect(quiet).toMatchObject({ latest: null, hasUpdate: false });

    // The attempt was recorded, so the next command does not try again.
    expect(readUpdateState().lastCheckedAt).toBeDefined();
    const after = await checkForUpdate({ fetchLatest: registry });
    expect(after.hasUpdate).toBe(false);
  });
});

describe("the passive notice", () => {
  // The CLI writes to stdout directly rather than through console, so that is
  // what has to be watched.
  const capture = () => {
    const lines: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });
    return { lines, restore: () => spy.mockRestore() };
  };

  it("announces a new release once, then stops", async () => {
    const first = capture();
    await finishUpdateCheck(beginUpdateCheck({ fetchLatest: says(later) }));
    first.restore();
    expect(first.lines.join("\n")).toContain(later);
    expect(readUpdateState().lastNotifiedVersion).toBe(later);

    const second = capture();
    await finishUpdateCheck(beginUpdateCheck({ fetchLatest: says(later) }));
    second.restore();
    expect(second.lines.join("\n")).not.toContain(later);
  });

  it("says nothing at all when there is nothing to say", async () => {
    const quiet = capture();
    await finishUpdateCheck(beginUpdateCheck({ fetchLatest: says(current) }));
    quiet.restore();
    expect(quiet.lines.join("")).toBe("");
  });

  it("does not wait for a registry that never answers", async () => {
    // A check that hangs must cost the command its grace period and no more.
    const started = Date.now();
    await finishUpdateCheck(beginUpdateCheck({ fetchLatest: hangsForever }));
    const waited = Date.now() - started;

    expect(waited).toBeLessThan(1000);
  });
});

describe("syncInstalledSkills", () => {
  const fake = (id: string, name: string, onInstall?: () => Promise<never>) => {
    const calls: string[] = [];
    const installer: SkillInstaller = {
      id,
      name,
      detect: () => Promise.resolve(true),
      install: onInstall
        ? onInstall
        : () => {
            calls.push(id);
            return Promise.resolve({ ok: true, where: `/fake/${id}` });
          },
    };
    return { installer, calls };
  };

  it("updates a target the developer approved", async () => {
    writeSkillState({
      targets: { "claude-code": { installed: true, autoUpdate: true } },
    });
    const claude = fake("claude-code", "Claude Code");

    const results = await syncInstalledSkills("9.9.9", [claude.installer]);

    expect(results).toEqual([
      { agent: "Claude Code", ok: true, why: "/fake/claude-code" },
    ]);
    expect(readSkillState().skillVersion).toBe("9.9.9");
  });

  it("leaves an agent that was never approved alone", async () => {
    writeSkillState({
      targets: { "claude-code": { installed: true, autoUpdate: true } },
    });
    const claude = fake("claude-code", "Claude Code");
    const cursor = fake("cursor", "Cursor");

    await syncInstalledSkills("9.9.9", [claude.installer, cursor.installer]);

    // Cursor appeared on the machine after consent was given. It is not Cira's
    // to write into.
    expect(cursor.calls).toEqual([]);
    expect(claude.calls).toEqual(["claude-code"]);
  });

  it("respects a target whose auto-update was declined", async () => {
    writeSkillState({
      targets: {
        "claude-code": { installed: true, autoUpdate: false },
        pi: { installed: true, autoUpdate: true },
      },
    });
    const claude = fake("claude-code", "Claude Code");
    const pi = fake("pi", "Pi");

    await syncInstalledSkills("9.9.9", [claude.installer, pi.installer]);

    expect(claude.calls).toEqual([]);
    expect(pi.calls).toEqual(["pi"]);
  });

  it("lets one target fail without touching the others", async () => {
    writeSkillState({
      targets: {
        "claude-code": { installed: true, autoUpdate: true },
        cursor: { installed: true, autoUpdate: true },
        pi: { installed: true, autoUpdate: true },
      },
    });
    const claude = fake("claude-code", "Claude Code");
    const broken = fake("cursor", "Cursor", () => Promise.reject(new Error("read-only")));
    const pi = fake("pi", "Pi");

    const results = await syncInstalledSkills("9.9.9", [
      claude.installer,
      broken.installer,
      pi.installer,
    ]);

    expect(results.map((r) => [r.agent, r.ok])).toEqual([
      ["Claude Code", true],
      ["Cursor", false],
      ["Pi", true],
    ]);
    expect(claude.calls).toEqual(["claude-code"]);
    expect(pi.calls).toEqual(["pi"]);
  });
});

describe("cira update", () => {
  it("says it is up to date and touches nothing", async () => {
    const updateCli = vi.fn(() => Promise.resolve());
    const code = await updateCommand({ fetchLatest: says(current), updateCli });

    expect(code).toBe(0);
    expect(updateCli).not.toHaveBeenCalled();
  });

  it("updates the CLI, then the skills that were approved", async () => {
    writeSkillState({ targets: { pi: { installed: true, autoUpdate: true } } });
    const order: string[] = [];

    const pi: SkillInstaller = {
      id: "pi",
      name: "Pi",
      detect: () => Promise.resolve(true),
      install: () => {
        order.push("skill");
        return Promise.resolve({ ok: true, where: "/fake/pi" });
      },
    };

    const code = await updateCommand({
      fetchLatest: says(later),
      updateCli: () => {
        order.push("cli");
        return Promise.resolve();
      },
      agents: [pi],
    });

    expect(code).toBe(0);
    // The skill that ships with a release cannot be synced before the release
    // is installed.
    expect(order).toEqual(["cli", "skill"]);
    expect(readSkillState().skillVersion).toBe(later);
  });

  it("stops and leaves the installation alone when the CLI update fails", async () => {
    writeSkillState({ targets: { pi: { installed: true, autoUpdate: true } } });
    const pi = {
      id: "pi",
      name: "Pi",
      detect: () => Promise.resolve(true),
      install: vi.fn(),
    };

    const code = await updateCommand({
      fetchLatest: says(later),
      updateCli: () => Promise.reject(new Error("EACCES")),
      agents: [pi as unknown as SkillInstaller],
    });

    expect(code).toBe(1);
    expect(pi.install).not.toHaveBeenCalled();
  });

  it("is idempotent: running it again reports up to date", async () => {
    const updateCli = vi.fn(() => Promise.resolve());
    await updateCommand({ fetchLatest: says(current), updateCli });
    const second = await updateCommand({ fetchLatest: says(current), updateCli });

    expect(second).toBe(0);
    expect(updateCli).not.toHaveBeenCalled();
  });

  it("does not then repeat the notice for the version it just installed", async () => {
    writeUpdateState({});
    await updateCommand({
      fetchLatest: says(later),
      updateCli: () => Promise.resolve(),
      agents: [],
    });
    expect(readUpdateState().lastNotifiedVersion).toBe(later);
  });
});

describe("state files", () => {
  it("treats a corrupt file as absent rather than failing a command", () => {
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "update-state.json"), "{ not json");
    writeFileSync(join(home, "skill-state.json"), "also not json");

    expect(readUpdateState()).toEqual({});
    expect(readSkillState()).toEqual({ targets: {} });
  });

  it("records the skill version it wrote", async () => {
    writeSkillState({ targets: { pi: { installed: true, autoUpdate: true } } });
    await syncInstalledSkills(canonicalSkill().version, [
      {
        id: "pi",
        name: "Pi",
        detect: () => Promise.resolve(true),
        install: () => Promise.resolve({ ok: true, where: "/fake/pi" }),
      },
    ]);

    const written = JSON.parse(readFileSync(join(home, "skill-state.json"), "utf8")) as {
      skillVersion: string;
    };
    expect(written.skillVersion).toBe(canonicalSkill().version);
  });
});
