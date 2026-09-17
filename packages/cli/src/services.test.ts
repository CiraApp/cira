import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverServices } from "./services.js";

/**
 * Working out what a repository actually deploys.
 *
 * Nobody writes any of this down for Cira. The repository has already said it,
 * by having the files each half's own toolchain needs, so this reads what is
 * there rather than asking for it again in a different format.
 */

let root: string;

function repo(files: Record<string, string>): string {
  root = mkdtempSync(join(tmpdir(), "cira-discover-"));
  for (const [path, body] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
});

const nextApp = JSON.stringify({
  dependencies: { next: "16" },
  scripts: { start: "next start" },
});

describe("discoverServices", () => {
  it("finds a frontend and the API behind it", () => {
    const found = discoverServices(
      repo({
        "package.json": JSON.stringify({ workspaces: ["apps/*"] }),
        "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
        "apps/web/package.json": nextApp,
        "apps/api/pyproject.toml": "[project]\nname='api'\n",
        "apps/api/Dockerfile": "FROM python:3.12\nEXPOSE 8000\n",
      }),
    );

    expect(found.services.map((s) => s.slug)).toEqual(["api", "web"]);
    expect(found.ingress?.slug).toBe("web");
    expect(found.ambiguity).toBeNull();
  });

  it("reads each half's own build instructions", () => {
    const found = discoverServices(
      repo({
        "apps/web/package.json": nextApp,
        "apps/api/go.mod": "module api\n",
        "apps/api/Dockerfile": "FROM golang\nEXPOSE 9000\n",
      }),
    );

    const api = found.services.find((s) => s.slug === "api");
    // Named from the repository root, because that is the build context: a
    // monorepo's lockfile is there, not beside the service.
    expect(api?.dockerfile).toBe("apps/api/Dockerfile");
    expect(api?.port).toBe(9000);
    expect(found.services.find((s) => s.slug === "web")?.dockerfile).toBeNull();
  });

  /** The ordinary app, which is almost every app, and must not change. */
  it("treats a plain single project as one service at the root", () => {
    const found = discoverServices(repo({ "package.json": nextApp }));

    expect(found.services).toHaveLength(1);
    expect(found.services[0]?.sourcePath).toBe("");
    expect(found.ingress?.slug).toBe("app");
  });

  it("does not mistake a library for something to deploy", () => {
    // Every monorepo is full of packages that build and never run.
    const found = discoverServices(
      repo({
        "apps/web/package.json": nextApp,
        "packages/ui/package.json": JSON.stringify({
          name: "ui",
          scripts: { build: "tsc" },
        }),
        "apps/tokens/package.json": JSON.stringify({
          name: "tokens",
          scripts: { build: "tsc" },
        }),
      }),
    );

    expect(found.services.map((s) => s.slug)).toEqual(["web"]);
  });

  it("ignores a workspace root that only holds the parts together", () => {
    const found = discoverServices(
      repo({
        "package.json": JSON.stringify({
          workspaces: ["apps/*"],
          scripts: { dev: "turbo dev" },
        }),
        "apps/web/package.json": nextApp,
        "apps/api/pyproject.toml": "[project]\nname='api'\n",
        "apps/api/Dockerfile": "FROM python:3.12\n",
      }),
    );

    expect(found.services.map((s) => s.sourcePath).sort()).toEqual([
      "apps/api",
      "apps/web",
    ]);
  });

  it("prefers the more specific framework when two look browser-facing", () => {
    const found = discoverServices(
      repo({
        "apps/web/package.json": nextApp,
        "apps/api/package.json": JSON.stringify({ scripts: { start: "node server.js" } }),
      }),
    );

    expect(found.ingress?.slug).toBe("web");
  });

  it("says so rather than guessing when it cannot tell", () => {
    // Two Node services and nothing to separate them. Deploying the wrong one
    // on the port produces an app that builds, runs, and serves the wrong
    // thing - so this refuses instead.
    const found = discoverServices(
      repo({
        "apps/one/package.json": JSON.stringify({ scripts: { start: "node a.js" } }),
        "apps/two/package.json": JSON.stringify({ scripts: { start: "node b.js" } }),
      }),
    );

    expect(found.ingress).toBeNull();
    expect(found.ambiguity).toContain("one and two");
  });

  it("says so when nothing looks like the half a browser opens", () => {
    const found = discoverServices(
      repo({
        "apps/api/pyproject.toml": "[project]\nname='api'\n",
        "apps/worker/go.mod": "module worker\n",
      }),
    );

    expect(found.ingress).toBeNull();
    expect(found.ambiguity).toContain("none of them");
  });
});
