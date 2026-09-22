import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverProcesses } from "./processes.js";
import { discoverServices } from "./services.js";

/**
 * Finding workers and scheduled runs where repositories already keep them,
 * and telling which of the app's parts each one belongs to.
 */

let root: string;

function repo(files: Record<string, string>): string {
  root = mkdtempSync(join(tmpdir(), "cira-processes-"));
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

const find = (files: Record<string, string>) => {
  const at = repo(files);
  return discoverProcesses(at, discoverServices(at).services);
};

describe("discoverProcesses", () => {
  it("finds Wave's worker in infra/fly.toml and puts it in the API's image", () => {
    const found = find({
      "package.json": JSON.stringify({ workspaces: ["apps/*"] }),
      "apps/web/package.json": JSON.stringify({
        dependencies: { next: "16" },
        scripts: { start: "next start" },
      }),
      "apps/api/Dockerfile": "FROM python:3.12\nEXPOSE 8000\n",
      "apps/api/pyproject.toml": "[project]\nname='api'\n",
      "infra/fly.toml": [
        "[build]",
        '  dockerfile = "../apps/api/Dockerfile"',
        "[processes]",
        '  api = "uvicorn app.main:app"',
        '  worker = "arq app.workers.settings.WorkerSettings"',
        "[http_service]",
        '  processes = ["api"]',
        "[[vm]]",
        '  memory = "1024mb"',
        '  processes = ["worker"]',
      ].join("\n"),
    });

    expect(found.web).toBe(true);
    expect(found.processes).toEqual([
      {
        name: "worker",
        kind: "worker",
        command: "arq app.workers.settings.WorkerSettings",
        schedule: null,
        source: "fly.toml",
        memoryMiB: 1024,
        service: "api",
      },
    ]);
  });

  it("sizes a Procfile's processes from the app.json beside it", () => {
    const found = find({
      "requirements.txt": "requests\n",
      Procfile: "web: gunicorn app:app\nworker: python worker.py\nsync: python sync.py\n",
      "app.json": JSON.stringify({ formation: { worker: { size: "performance-m" } } }),
    });
    expect(found.processes.map((p) => [p.name, p.memoryMiB])).toEqual([
      ["worker", 2560],
      ["sync", null],
    ]);
  });

  it("reads a script-only app from its Procfile as having no web process", () => {
    const found = find({
      "requirements.txt": "requests\n",
      Procfile: "sync: python sync.py\n",
      "sync.py": "print('hi')\n",
    });
    expect(found.web).toBe(false);
    expect(found.processes.map((p) => [p.name, p.service])).toEqual([["sync", "app"]]);
  });

  it("takes a GitHub Actions schedule, with the path made relative to its part", () => {
    const found = find({
      "package.json": JSON.stringify({ workspaces: ["apps/*"] }),
      "apps/web/package.json": JSON.stringify({
        dependencies: { next: "16" },
        scripts: { start: "next start" },
      }),
      "apps/api/Dockerfile": "FROM python:3.12\n",
      ".github/workflows/weekly.yml": [
        "on:",
        "  schedule:",
        '    - cron: "0 9 * * 1"',
        "jobs:",
        "  run:",
        "    steps:",
        "      - run: python apps/api/scripts/weekly_report.py",
      ].join("\n"),
    });
    expect(found.processes).toEqual([
      {
        name: "weekly",
        kind: "scheduled",
        command: "python scripts/weekly_report.py",
        schedule: "0 9 * * 1",
        source: "GitHub Actions",
        memoryMiB: null,
        service: "api",
      },
    ]);
  });

  it("says nothing about an ordinary app", () => {
    const found = find({
      "package.json": JSON.stringify({
        dependencies: { next: "16" },
        scripts: { start: "next start" },
      }),
    });
    expect(found).toEqual({
      web: null,
      processes: [],
      webMemoryMiB: null,
      release: null,
    });
  });

  it("gives the web process the size an app.json formation says", () => {
    const found = find({
      "package.json": JSON.stringify({
        dependencies: { next: "16" },
        scripts: { start: "next start" },
      }),
      Procfile: "web: npm start\nworker: node worker.js\n",
      "app.json": JSON.stringify({
        formation: { web: { size: "standard-2x" }, worker: { size: "basic" } },
      }),
    });
    expect(found.webMemoryMiB).toBe(1024);
    expect(found.processes[0]?.memoryMiB).toBe(512);
  });
});
