import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalSkill } from "@cira/skill";
import { claudeCode } from "./claude-code.js";
import { codex } from "./codex.js";
import { cursor } from "./cursor.js";
import { detectAgents, installSkill, mergeBlock } from "./index.js";
import type { SkillEnv } from "./installer.js";

/**
 * Installing runs against a real temporary filesystem rather than mocks.
 * Writing files correctly is the entire job, so a test that does not write
 * files would be testing the wrong thing.
 */

let root: string;
let env: SkillEnv;

const skill = canonicalSkill();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cira-skill-"));
  mkdirSync(join(root, "home"), { recursive: true });
  mkdirSync(join(root, "project"), { recursive: true });
  writeFileSync(join(root, "project", "package.json"), "{}\n");
  env = { home: join(root, "home"), cwd: join(root, "project") };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env["CLAUDE_CONFIG_DIR"];
  delete process.env["CODEX_HOME"];
});

const withClaude = () => mkdirSync(join(env.home, ".claude"), { recursive: true });
const withCodex = () => mkdirSync(join(env.home, ".codex"), { recursive: true });
const withCursor = () => mkdirSync(join(env.home, ".cursor"), { recursive: true });

describe("detection", () => {
  it("finds nothing on a machine with no coding agents", async () => {
    expect(await detectAgents(env)).toEqual([]);
  });

  it("finds each agent by its own configuration directory", async () => {
    withClaude();
    withCursor();
    expect((await detectAgents(env)).map((a) => a.name)).toEqual([
      "Claude Code",
      "Cursor",
    ]);

    withCodex();
    expect((await detectAgents(env)).map((a) => a.name)).toEqual([
      "Claude Code",
      "Codex",
      "Cursor",
    ]);
  });

  it("respects the environment variables those agents document", async () => {
    const elsewhere = join(root, "elsewhere");
    mkdirSync(elsewhere, { recursive: true });
    process.env["CLAUDE_CONFIG_DIR"] = elsewhere;

    expect(await claudeCode(env).detect()).toBe(true);
  });
});

describe("Claude Code", () => {
  it("writes the canonical file through, unchanged", async () => {
    withClaude();
    const result = await claudeCode(env).install(skill);

    expect(result.ok).toBe(true);
    const path = join(env.home, ".claude", "skills", "cira", "SKILL.md");
    expect(readFileSync(path, "utf8").trim()).toBe(skill.source.trim());
  });
});

describe("Codex", () => {
  it("creates AGENTS.md when the developer has none", async () => {
    withCodex();
    await codex(env).install(skill);

    const written = readFileSync(join(env.home, ".codex", "AGENTS.md"), "utf8");
    expect(written).toContain("<!-- cira:skill:start -->");
    expect(written).toContain("# Cira");
  });

  it("keeps instructions the developer already had", async () => {
    withCodex();
    const path = join(env.home, ".codex", "AGENTS.md");
    writeFileSync(path, "# My rules\n\nAlways write tests first.\n");

    await codex(env).install(skill);

    const written = readFileSync(path, "utf8");
    expect(written).toContain("Always write tests first.");
    expect(written).toContain("# Cira");
  });

  it("replaces its own block rather than stacking copies", async () => {
    withCodex();
    const path = join(env.home, ".codex", "AGENTS.md");
    writeFileSync(path, "# My rules\n");

    await codex(env).install(skill);
    const once = readFileSync(path, "utf8");
    await codex(env).install(skill);
    const twice = readFileSync(path, "utf8");

    expect(twice).toBe(once);
    expect(twice.match(/cira:skill:start/g)).toHaveLength(1);
    expect(twice).toContain("# My rules");
  });
});

describe("Cursor", () => {
  it("writes a project rule with the frontmatter .mdc requires", async () => {
    withCursor();
    const result = await cursor(env).install(skill);

    expect(result.ok).toBe(true);
    const written = readFileSync(join(env.cwd, ".cursor", "rules", "cira.mdc"), "utf8");
    // A plain .md in .cursor/rules is ignored, so these three fields are the
    // one adaptation a provider forces on us.
    expect(written.startsWith("---\n")).toBe(true);
    expect(written).toContain("description:");
    expect(written).toContain("alwaysApply:");
    expect(written).toContain("# Cira");
  });

  it("says why rather than scattering a .cursor folder outside a project", async () => {
    withCursor();
    const homeless = { ...env, cwd: join(root, "home") };

    const result = await cursor(homeless).install(skill);
    expect(result).toEqual({
      ok: false,
      why: "run this from a project folder - Cursor rules live in the project",
    });
  });
});

describe("installing across agents", () => {
  it("gives every agent the same skill, whatever the wrapper", async () => {
    withClaude();
    withCodex();
    withCursor();

    await installSkill(await detectAgents(env));

    const claude = readFileSync(
      join(env.home, ".claude", "skills", "cira", "SKILL.md"),
      "utf8",
    );
    const codexFile = readFileSync(join(env.home, ".codex", "AGENTS.md"), "utf8");
    const cursorFile = readFileSync(
      join(env.cwd, ".cursor", "rules", "cira.mdc"),
      "utf8",
    );

    // The packaging differs by necessity; the content must not.
    for (const written of [claude, codexFile, cursorFile]) {
      expect(written).toContain(skill.body.trim());
    }
  });

  it("is safe to run twice", async () => {
    withClaude();
    withCodex();
    withCursor();

    const first = await installSkill(await detectAgents(env));
    const before = snapshot();
    const second = await installSkill(await detectAgents(env));

    expect(second).toEqual(first);
    expect(snapshot()).toEqual(before);
  });

  it("does not let one agent's failure touch the others", async () => {
    withClaude();
    withCodex();

    const broken = {
      name: "Broken",
      detect: () => Promise.resolve(true),
      install: () => Promise.reject(new Error("permission denied")),
    };

    const reports = await installSkill([...(await detectAgents(env)), broken]);

    expect(reports.find((r) => r.agent === "Broken")?.result).toEqual({
      ok: false,
      why: "permission denied",
    });
    expect(reports.filter((r) => r.result.ok).map((r) => r.agent)).toEqual([
      "Claude Code",
      "Codex",
    ]);

    // The two that worked are intact.
    expect(
      readFileSync(join(env.home, ".claude", "skills", "cira", "SKILL.md"), "utf8"),
    ).toContain("# Cira");
    expect(readFileSync(join(env.home, ".codex", "AGENTS.md"), "utf8")).toContain(
      "# Cira",
    );
  });

  it("writes nothing at all when there is nothing to write into", async () => {
    const reports = await installSkill(await detectAgents(env));
    expect(reports).toEqual([]);
    expect(snapshot()).toEqual([]);
  });

  function snapshot(): string[] {
    const paths = [
      join(env.home, ".claude", "skills", "cira", "SKILL.md"),
      join(env.home, ".codex", "AGENTS.md"),
      join(env.cwd, ".cursor", "rules", "cira.mdc"),
    ];
    return paths.flatMap((path) => {
      try {
        return [`${path}::${readFileSync(path, "utf8")}`];
      } catch {
        return [];
      }
    });
  }
});

describe("mergeBlock", () => {
  it("adds, then replaces in place", () => {
    const once = mergeBlock("# Mine\n", "cira one");
    expect(once).toContain("# Mine");

    const twice = mergeBlock(once, "cira two");
    expect(twice).toContain("cira two");
    expect(twice).not.toContain("cira one");
    expect(twice.match(/cira:skill:start/g)).toHaveLength(1);
  });

  it("leaves what surrounds it alone", () => {
    const start =
      "# Top\n\n<!-- cira:skill:start -->\nold\n<!-- cira:skill:end -->\n\n# Bottom\n";
    const merged = mergeBlock(start, "new");
    expect(merged).toContain("# Top");
    expect(merged).toContain("# Bottom");
    expect(merged).toContain("new");
    expect(merged).not.toContain("old");
  });
});
