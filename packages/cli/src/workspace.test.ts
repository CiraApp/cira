import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readWorkspacePackage,
  workspaceAround,
  workspaceDockerfile,
} from "./workspace.js";

/**
 * One app out of a JavaScript workspace: finding the workspace from inside a
 * package, and the Dockerfile that builds that package from the root.
 */

let root: string;

function repo(files: Record<string, string>): string {
  root = mkdtempSync(join(tmpdir(), "cira-workspace-"));
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

/** The layout `create-turbo` writes, trimmed to what decides anything. */
const TURBO = {
  ".git/HEAD": "ref: refs/heads/main\n",
  "package.json": JSON.stringify({
    name: "acme",
    private: true,
    packageManager: "pnpm@9.0.0",
    devDependencies: { turbo: "^2" },
  }),
  "pnpm-workspace.yaml": 'packages:\n  - "apps/*"\n  - "packages/*"\n',
  "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
  "turbo.json": JSON.stringify({ tasks: { build: { dependsOn: ["^build"] } } }),
  "apps/web/package.json": JSON.stringify({
    name: "web",
    scripts: { build: "next build", start: "next start" },
    dependencies: { next: "16", "@repo/ui": "workspace:*" },
  }),
  "apps/docs/package.json": JSON.stringify({
    name: "docs",
    scripts: { build: "next build", start: "next start" },
    dependencies: { next: "16" },
  }),
  "packages/ui/package.json": JSON.stringify({ name: "@repo/ui" }),
};

describe("workspaceAround", () => {
  it("finds the workspace a package sits in, and what builds it", () => {
    const at = repo(TURBO);
    expect(workspaceAround(join(at, "apps/web"))).toEqual({
      root: at,
      manager: "pnpm",
      yarnBerry: false,
      turbo: true,
    });
  });

  it("finds nothing at the workspace's own root, or outside any workspace", () => {
    const at = repo(TURBO);
    expect(workspaceAround(at)).toBeNull();
    const plain = repo({ ".git/HEAD": "x", "package.json": "{}" });
    expect(workspaceAround(plain)).toBeNull();
  });

  // A checkout that happens to sit inside someone's workspace folder is still
  // its own app.
  it("stops at a package that is its own repository", () => {
    const at = repo({ ...TURBO, "apps/web/.git/HEAD": "x" });
    expect(workspaceAround(join(at, "apps/web"))).toBeNull();
  });

  it("tells npm, yarn and bun workspaces apart by their lockfile", () => {
    const npm = repo({
      "package.json": JSON.stringify({ workspaces: ["apps/*"] }),
      "package-lock.json": "{}",
      "apps/web/package.json": "{}",
    });
    expect(workspaceAround(join(npm, "apps/web"))?.manager).toBe("npm");
    const yarn = repo({
      "package.json": JSON.stringify({ workspaces: { packages: ["apps/*"] } }),
      "yarn.lock": "",
      ".yarnrc.yml": "nodeLinker: node-modules\n",
      "apps/web/package.json": "{}",
    });
    expect(workspaceAround(join(yarn, "apps/web"))).toMatchObject({
      manager: "yarn",
      yarnBerry: true,
    });
  });
});

describe("workspaceDockerfile", () => {
  it("installs from the root lockfile and builds the package after its dependencies", () => {
    const at = repo({ ...TURBO, "apps/web/.nvmrc": "20\n" });
    const workspace = workspaceAround(join(at, "apps/web"))!;
    const pkg = readWorkspacePackage(workspace, join(at, "apps/web"));
    const text = workspaceDockerfile({
      workspace,
      pkg,
      publicNames: ["NEXT_PUBLIC_API_URL"],
    });

    expect(text).toContain("FROM node:20-slim");
    expect(text).toContain("RUN pnpm install --frozen-lockfile");
    expect(text).toContain("RUN pnpm exec turbo run build --filter=web");
    // A browser-public variable reaches the build, which compiles it in.
    expect(text).toContain(
      "ARG NEXT_PUBLIC_API_URL\nENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL",
    );
    expect(text).toContain("WORKDIR /workspace/apps/web");
    expect(text).toContain('CMD ["sh", "-c", "pnpm start"]');
  });

  it("builds with each manager's own filter when there is no turbo", () => {
    const at = repo({
      "package.json": JSON.stringify({ workspaces: ["apps/*"] }),
      "package-lock.json": "{}",
      "apps/web/package.json": JSON.stringify({
        name: "web",
        scripts: { build: "vite build", start: "node server.js" },
      }),
    });
    const workspace = workspaceAround(join(at, "apps/web"))!;
    const text = workspaceDockerfile({
      workspace,
      pkg: readWorkspacePackage(workspace, join(at, "apps/web")),
      publicNames: [],
    });
    expect(text).toContain("FROM node:22-slim");
    expect(text).toContain("RUN npm ci");
    expect(text).toContain("RUN npm run build --workspace=apps/web");
    expect(text).toContain('CMD ["sh", "-c", "npm run start"]');
    expect(text).not.toContain("ARG ");
  });
});
