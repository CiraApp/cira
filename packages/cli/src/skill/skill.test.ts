import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalSkill } from "@cira/skill";
import { claudeCode, codex, geminiCli, pi } from "./agents.js";
import { cursor } from "./cursor.js";
import { detectAgents, installSkill, sharedSkillsDir } from "./index.js";
import type { SkillEnv } from "./installer.js";

/**
 * Installing runs against a real temporary filesystem rather than mocks.
 * Writing files correctly is the entire job, so a test that does not write
 * files would be testing the wrong thing.
 *
 * `path` is empty in every case, so detection sees only the fake home and
 * never whatever happens to be installed on the machine running the suite.
 */

let root: string;
let env: SkillEnv;

const skill = canonicalSkill();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cira-skill-"));
  mkdirSync(join(root, "home"), { recursive: true });
  mkdirSync(join(root, "project"), { recursive: true });
  writeFileSync(join(root, "project", "package.json"), "{}\n");
  env = { home: join(root, "home"), cwd: join(root, "project"), path: [] };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env["CLAUDE_CONFIG_DIR"];
  delete process.env["CODEX_HOME"];
});

const withAgent = (dir: string) => mkdirSync(join(env.home, dir), { recursive: true });
const read = (path: string) => readFileSync(path, "utf8");
const shared = () => join(sharedSkillsDir(env), "cira", "SKILL.md");
const claudePath = () => join(env.home, ".claude", "skills", "cira", "SKILL.md");
const cursorPath = () => join(env.cwd, ".cursor", "rules", "cira.mdc");

describe("detection", () => {
  it("finds nothing on a machine with no coding agents", async () => {
    expect(await detectAgents(env)).toEqual([]);
  });

  it("finds each agent by its own configuration directory", async () => {
    for (const dir of [".claude", ".codex", ".pi", ".gemini", ".cursor"]) {
      withAgent(dir);
    }
    expect((await detectAgents(env)).map((a) => a.name)).toEqual([
      "Claude Code",
      "Codex",
      "Pi",
      "Gemini CLI",
      "Cursor",
    ]);
  });

  it("finds an agent that is on the PATH but has never been run", async () => {
    // The WSL case: Cursor installed on the Windows side has a reachable
    // binary and no configuration directory this side of the boundary.
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "cursor"), "");

    expect(await cursor({ ...env, path: [bin] }).detect()).toBe(true);
    expect(await cursor(env).detect()).toBe(false);
  });

  it("respects the environment variables those agents document", async () => {
    const elsewhere = join(root, "elsewhere");
    mkdirSync(elsewhere, { recursive: true });
    process.env["CLAUDE_CONFIG_DIR"] = elsewhere;
    expect(await claudeCode(env).detect()).toBe(true);
  });
});

describe("the shared skills directory", () => {
  it("is one file for Codex, Pi and Gemini CLI", async () => {
    for (const agent of [codex(env), pi(env), geminiCli(env)]) {
      const result = await agent.install(skill);
      expect(result).toEqual({ ok: true, where: shared() });
    }

    expect(read(shared()).trim()).toBe(skill.source.trim());
  });

  it("gives Claude Code its own copy, because it reads nowhere else", async () => {
    const result = await claudeCode(env).install(skill);

    expect(result).toEqual({ ok: true, where: claudePath() });
    expect(claudePath()).not.toBe(shared());
    expect(read(claudePath()).trim()).toBe(skill.source.trim());
  });
});

describe("Cursor", () => {
  it("writes a project rule with the frontmatter .mdc requires", async () => {
    const result = await cursor(env).install(skill);

    expect(result.ok).toBe(true);
    const written = read(cursorPath());
    // A plain .md in .cursor/rules is ignored, so these fields are the one
    // adaptation any provider forces on us.
    expect(written.startsWith("---\n")).toBe(true);
    expect(written).toContain("description:");
    expect(written).toContain("alwaysApply:");
    expect(written).toContain("# Cira");
  });

  it("says why rather than scattering a .cursor folder outside a project", async () => {
    const homeless = { ...env, cwd: join(root, "home") };

    expect(await cursor(homeless).install(skill)).toEqual({
      ok: false,
      why: "run this from a project folder - Cursor rules live in the project",
    });
  });
});

describe("installing across agents", () => {
  const everything = () => {
    for (const dir of [".claude", ".codex", ".pi", ".gemini", ".cursor"]) {
      withAgent(dir);
    }
  };

  it("gives every agent the same skill, whatever the wrapper", async () => {
    everything();
    await installSkill(await detectAgents(env));

    for (const path of [claudePath(), shared(), cursorPath()]) {
      expect(read(path), path).toContain(skill.body.trim());
    }
  });

  it("writes three files for five agents", async () => {
    everything();
    const reports = await installSkill(await detectAgents(env));

    const paths = new Set(reports.flatMap((r) => (r.result.ok ? [r.result.where] : [])));
    expect(reports).toHaveLength(5);
    expect(paths.size).toBe(3);
  });

  it("is safe to run twice", async () => {
    everything();
    const first = await installSkill(await detectAgents(env));
    const before = snapshot();
    const second = await installSkill(await detectAgents(env));

    expect(second).toEqual(first);
    expect(snapshot()).toEqual(before);
  });

  it("does not let one agent's failure touch the others", async () => {
    everything();
    const broken = {
      id: "broken",
      name: "Broken",
      detect: () => Promise.resolve(true),
      install: () => Promise.reject(new Error("permission denied")),
    };

    const reports = await installSkill([...(await detectAgents(env)), broken]);

    expect(reports.find((r) => r.agent === "Broken")?.result).toEqual({
      ok: false,
      why: "permission denied",
    });
    expect(read(claudePath())).toContain("# Cira");
    expect(read(shared())).toContain("# Cira");
  });

  it("writes nothing at all when there is nothing to write into", async () => {
    const reports = await installSkill(await detectAgents(env));
    expect(reports).toEqual([]);
    expect(snapshot()).toEqual([]);
  });

  function snapshot(): string[] {
    return [claudePath(), shared(), cursorPath()].flatMap((path) => {
      try {
        return [`${path}::${read(path)}`];
      } catch {
        return [];
      }
    });
  }
});
