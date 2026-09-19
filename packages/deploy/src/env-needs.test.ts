import { describe, expect, it } from "vitest";
import { findEnvNeeds } from "./env-needs.js";

/**
 * The cheap pass over a repository, looking for what it will need told to it.
 *
 * Most of what matters here is what it stays quiet about. A list that names
 * everything is a list nobody reads, and this runs in front of every deploy.
 */
const file = (path: string, body: string) => ({
  path,
  mode: 0o644,
  body: Buffer.from(body),
});

const names = (entries: ReturnType<typeof file>[]) =>
  findEnvNeeds(entries).map((need) => need.name);

describe("findEnvNeeds", () => {
  it("finds what is read with nothing to fall back on", () => {
    expect(
      names([
        file("src/db.ts", "const url = process.env.DATABASE_URL;"),
        file("app/cache.py", 'import os\nr = os.environ["REDIS_URL"]'),
        file("main.go", 'v := os.Getenv("STRIPE_KEY")'),
      ]),
    ).toEqual(["DATABASE_URL", "REDIS_URL", "STRIPE_KEY"]);
  });

  it("stays quiet when the app copes without being told", () => {
    expect(
      names([
        file("a.ts", 'const x = process.env.LOG_LEVEL ?? "info";'),
        file("b.ts", 'const y = process.env.REGION || "us";'),
        file("c.py", 'v = os.environ.get("TIMEOUT", "30")'),
      ]),
    ).toEqual([]);
  });

  /**
   * A value only ever compared is a switch, and unset is simply "off". Asking
   * for one on every deploy is how a checklist teaches people to ignore it.
   */
  it("stays quiet about a switch, which is off when it is not set", () => {
    expect(
      names([
        file("log.py", 'if os.environ.get("QUIET") != "1":\n    log()'),
        file("flags.ts", 'const on = process.env.NEW_BILLING === "true";'),
        file("mode.py", 'if os.getenv("MODE") in ("a", "b"):\n    pass'),
        file("debug.rb", 'debug = ENV["DEBUG"] == "1"'),
        file("trace.go", 'if os.Getenv("TRACE") == "on" {}'),
      ]),
    ).toEqual([]);
  });

  it("still finds a value the app checks for before refusing to start", () => {
    expect(
      names([
        file("boot.ts", 'if (process.env.API_KEY === undefined) throw new Error("x");'),
        file("boot.py", 'if os.environ.get("SECRET") is None:\n    raise SystemExit'),
        file("boot.go", 'if os.Getenv("DSN") == "" { log.Fatal("DSN") }'),
      ]),
    ).toEqual(["API_KEY", "DSN", "SECRET"]);
  });

  /**
   * The one that bit Wave. A default means the app starts, so nothing fails at
   * deploy time - and the default names a service on the developer's own
   * machine, which inside a container is nothing at all.
   */
  it("finds a setting that falls back to the developer's own machine", () => {
    const found = findEnvNeeds([
      file(
        "app/config.py",
        [
          "class Settings(BaseSettings):",
          '    database_url: str = "postgresql://wave:wave@localhost:5432/wave"',
          '    redis_url: str = "redis://localhost:6379/0"',
          '    app_name: str = "wave"',
        ].join("\n"),
      ),
    ]);

    expect(found.map((n) => n.name)).toEqual(["DATABASE_URL", "REDIS_URL"]);
    expect(found[0]?.reason).toBe("defaults to localhost");
    // A setting that is not an address is not a missing service.
    expect(found.map((n) => n.name)).not.toContain("APP_NAME");
  });

  it("says nothing about documentation or tests", () => {
    // A skill file explaining how to set SENTRY_DSN reads exactly like code
    // reading it, and tests name a database because they stand one up.
    expect(
      names([
        file(".claude/skills/thing/SKILL.md", "Set process.env.SENTRY_DSN"),
        file("docs/deploy.md", 'os.environ["ADMIN_TOKEN"]'),
        file("apps/api/tests/conftest.py", 'os.environ["DATABASE_URL"]'),
        file("src/x.test.ts", "process.env.FIXTURE_KEY"),
      ]),
    ).toEqual([]);
  });

  it("says nothing about what the platform already sets", () => {
    expect(
      names([file("server.js", "process.env.PORT; process.env.K_SERVICE;")]),
    ).toEqual([]);
  });

  it("names each thing once, at the best place to go and look", () => {
    const found = findEnvNeeds([
      file("src/a.ts", "process.env.REDIS_URL"),
      file("app/config.py", '    redis_url: str = "redis://localhost:6379/0"'),
      file("src/b.ts", "process.env.REDIS_URL"),
    ]);

    expect(found).toHaveLength(1);
    // The settings class beats a bare read: it is where somebody would fix it.
    expect(found[0]?.file).toBe("app/config.py");
    expect(found[0]?.reason).toBe("defaults to localhost");
  });
});
