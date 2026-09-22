import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NGINX_CONFIG, staticDockerfile, staticSite } from "./static-site.js";

/**
 * A site with no server of its own used to be handed to buildpacks, which
 * built it and then had nothing to start. Now it is recognised and served.
 */

let root: string;

function repo(files: Record<string, string>): string {
  root = mkdtempSync(join(tmpdir(), "cira-static-"));
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

const pkg = (value: unknown) => JSON.stringify(value);

describe("staticSite", () => {
  it("knows a Vite single-page app and a Create React App one, by where they build to", () => {
    const vite = repo({
      "package.json": pkg({
        scripts: { build: "vite build" },
        devDependencies: { vite: "7" },
      }),
      "pnpm-lock.yaml": "",
    });
    expect(staticSite(vite)).toEqual({
      build: { manager: "pnpm", yarnBerry: false, nodeMajor: 22 },
      output: "dist",
    });
    const cra = repo({
      "package.json": pkg({
        scripts: { build: "react-scripts build" },
        dependencies: { "react-scripts": "5" },
      }),
    });
    expect(staticSite(cra)?.output).toBe("build");
  });

  it("serves a folder of HTML as it is", () => {
    expect(staticSite(repo({ "index.html": "<h1>hi</h1>" }))).toEqual({
      build: null,
      output: ".",
    });
  });

  it("leaves anything with a server alone", () => {
    const started = repo({
      "package.json": pkg({
        scripts: { build: "vite build", start: "node server.js" },
        devDependencies: { vite: "7" },
      }),
    });
    expect(staticSite(started)).toBeNull();
    const next = repo({
      "package.json": pkg({
        scripts: { build: "next build" },
        dependencies: { next: "16" },
      }),
    });
    expect(staticSite(next)).toBeNull();
    const api = repo({ "package.json": pkg({ scripts: { build: "tsc" } }) });
    expect(staticSite(api)).toBeNull();
  });
});

describe("staticDockerfile", () => {
  it("builds with the site's public variables, then serves only its output", () => {
    const text = staticDockerfile({
      site: {
        build: { manager: "npm", yarnBerry: false, nodeMajor: 22 },
        output: "dist",
      },
      path: "",
      publicNames: ["VITE_API_URL"],
    });
    expect(text).toContain("ARG VITE_API_URL\nENV VITE_API_URL=$VITE_API_URL");
    expect(text).toContain("RUN npm ci");
    expect(text).toContain("RUN cd /app && npm run build");
    expect(text).toContain("COPY --from=build /app/dist /usr/share/nginx/html");
  });

  it("builds a workspace package from the root, the workspace's way", () => {
    const text = staticDockerfile({
      site: {
        build: { manager: "pnpm", yarnBerry: false, nodeMajor: 22 },
        output: "dist",
      },
      path: "apps/admin",
      publicNames: [],
      buildCommand: "pnpm exec turbo run build --filter=admin",
    });
    expect(text).toContain("RUN pnpm install --frozen-lockfile");
    expect(text).toContain("RUN pnpm exec turbo run build --filter=admin");
    expect(text).toContain(
      "COPY --from=build /app/apps/admin/dist /usr/share/nginx/html",
    );
  });

  it("sends every path the site does not have to its index.html, on Cloud Run's port", () => {
    expect(NGINX_CONFIG).toContain("listen 8080;");
    expect(NGINX_CONFIG).toContain("try_files $uri $uri/ /index.html;");
  });
});
