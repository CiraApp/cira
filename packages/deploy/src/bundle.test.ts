import { describe, expect, it } from "vitest";
import { checkBundle, shouldUpload, type BundleFile } from "./bundle.js";

describe("shouldUpload", () => {
  it("takes ordinary source", () => {
    for (const p of [
      "package.json",
      "src/app/page.tsx",
      "public/logo.svg",
      "README.md",
    ]) {
      expect(shouldUpload(p)).toBe(true);
    }
  });

  it("never uploads dependencies or build output, at any depth", () => {
    for (const p of [
      "node_modules/react/index.js",
      "apps/web/node_modules/x/y.js",
      ".next/server/page.js",
      "dist/index.js",
      ".git/config",
      ".vercel/project.json",
      ".cira/project.json",
    ]) {
      expect(shouldUpload(p)).toBe(false);
    }
  });

  it("never uploads local secrets", () => {
    for (const p of [".env", ".env.local", ".env.production", "apps/web/.env.local"]) {
      expect(shouldUpload(p)).toBe(false);
    }
  });

  it("keeps the example env file, which is documentation not secrets", () => {
    expect(shouldUpload(".env.example")).toBe(true);
  });

  it("drops logs and build caches", () => {
    for (const p of ["debug.log", "tsconfig.tsbuildinfo", ".DS_Store"]) {
      expect(shouldUpload(p)).toBe(false);
    }
  });

  it("rejects an empty path rather than guessing", () => {
    expect(shouldUpload("")).toBe(false);
    expect(shouldUpload("/")).toBe(false);
  });
});

describe("checkBundle", () => {
  const file = (path: string, size: number): BundleFile => ({ path, size });

  it("accepts an ordinary project", () => {
    expect(checkBundle([file("package.json", 900), file("src/a.ts", 4000)]).ok).toBe(
      true,
    );
  });

  it("refuses an empty folder with a sentence, not a crash", () => {
    const v = checkBundle([]);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("nothing to deploy");
  });

  it("names the offending file when one is too big", () => {
    const v = checkBundle([file("assets/video.mp4", 40 * 1024 * 1024)]);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("assets/video.mp4");
  });

  it("refuses a folder that is too big overall", () => {
    const many = Array.from({ length: 200 }, (_, i) => file(`f${i}`, 1024 * 1024));
    const v = checkBundle(many);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("100 MB");
  });
});

/**
 * The rules were written when Cira only deployed Next.js and stayed that way
 * after it stopped. Deploying Wave sent 154 files of compiled Python bytecode,
 * 44% of the upload, and a repository with its virtual environment beside it
 * would have sent hundreds of megabytes of files the build regenerates anyway.
 */
describe("shouldUpload, in languages that are not JavaScript", () => {
  it("leaves out what the build makes for itself", () => {
    for (const path of [
      ".venv/lib/python3.12/site-packages/fastapi/__init__.py",
      "venv/bin/activate",
      "app/__pycache__/main.cpython-312.pyc",
      "alembic/versions/__pycache__/0001_initial.cpython-312.pyc",
      ".pytest_cache/v/cache/lastfailed",
      ".mypy_cache/3.12/app.json",
      ".ruff_cache/content",
      ".tox/py312/bin/python",
      "target/debug/deps/app.rlib",
      "target/classes/com/acme/App.class",
      ".gradle/caches/modules-2/files",
      "app/main.pyc",
      "com/acme/App.class",
    ]) {
      expect(shouldUpload(path), path).toBe(false);
    }
  });

  it("still sends the source those languages are written in", () => {
    for (const path of [
      "app/main.py",
      "app/routers/orders.py",
      "pyproject.toml",
      "uv.lock",
      "go.mod",
      "main.go",
      "Gemfile",
      "app.rb",
      "pom.xml",
      "src/main/java/com/acme/App.java",
      "Cargo.toml",
      "src/main.rs",
      "Dockerfile",
      "Procfile",
    ]) {
      expect(shouldUpload(path), path).toBe(true);
    }
  });

  /**
   * `vendor` is dependencies in PHP and in Go - but a Go module that commits
   * it builds *from* it, so dropping it turns a working repository into one
   * that cannot resolve its own imports. Sending it costs space; removing it
   * costs correctness, and only one of those is recoverable.
   */
  it("keeps vendored dependencies, which a Go build reads", () => {
    expect(shouldUpload("vendor/github.com/pkg/errors/errors.go")).toBe(true);
    expect(shouldUpload("vendor/modules.txt")).toBe(true);
  });

  // A directory whose name happens to match is excluded at any depth, which is
  // what makes nested __pycache__ go rather than only the one at the root.
  it("excludes at any depth, not only at the root", () => {
    expect(shouldUpload("services/api/app/__pycache__/x.pyc")).toBe(false);
    expect(shouldUpload("packages/worker/.venv/pyvenv.cfg")).toBe(false);
  });
});
