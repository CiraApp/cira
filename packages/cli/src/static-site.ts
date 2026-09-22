import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RUN, installCommand, managerOf, type PackageManager } from "./workspace.js";

/**
 * Sites with no server of their own.
 *
 * A Vite or Create React App single-page app, an Astro site, a folder of HTML:
 * built, they are files, and nothing in them listens on a port. Handed to
 * buildpacks they either failed to build or built and then never started, and
 * the deploy failed with nothing a person could act on. So Cira recognises
 * them and serves the files itself, with nginx, sending every path the site
 * does not have to its `index.html`, the way a single-page app's router
 * expects.
 */

export interface StaticSite {
  /** Whether it is built first, and with what. Null for plain files. */
  build: { manager: PackageManager; yarnBerry: boolean; nodeMajor: number } | null;
  /** Where the built files are, relative to the site's folder. */
  output: string;
}

/** Where each builder leaves a site, by the dependency that says which it is. */
const OUTPUTS: ReadonlyArray<[string, string]> = [
  ["react-scripts", "build"],
  ["vite", "dist"],
  ["astro", "dist"],
  ["@vue/cli-service", "dist"],
  ["parcel", "dist"],
];

/** A site in `dir` that only needs its files served, or null. */
export function staticSite(dir: string, root: string = dir): StaticSite | null {
  const pkg = readJson(join(dir, "package.json"));
  if (pkg === null) {
    return existsSync(join(dir, "index.html")) ? { build: null, output: "." } : null;
  }

  const scripts = (pkg["scripts"] ?? {}) as Record<string, unknown>;
  // A start script is a server, whatever else the package has.
  if (typeof scripts["start"] === "string" || typeof scripts["build"] !== "string") {
    return null;
  }
  const deps = {
    ...((pkg["dependencies"] ?? {}) as Record<string, unknown>),
    ...((pkg["devDependencies"] ?? {}) as Record<string, unknown>),
  };
  // Frameworks that render on a server are never static here, even without
  // a start script: guessing would serve an app with half of it missing.
  if (
    ["next", "nuxt", "@remix-run/node", "@sveltejs/kit", "express"].some((d) => d in deps)
  ) {
    return null;
  }
  const output = OUTPUTS.find(([dep]) => dep in deps)?.[1];
  if (output === undefined) return null;

  return {
    build: {
      manager: managerOf(root),
      yarnBerry: existsSync(join(root, ".yarnrc.yml")),
      nodeMajor: 22,
    },
    output,
  };
}

/**
 * The Dockerfile that builds a static site and serves it. `path` is the
 * site's folder within the upload, empty when it is the whole upload; the
 * install runs where the lockfile is, which in a workspace is the root.
 */
export function staticDockerfile(args: {
  site: StaticSite;
  path: string;
  publicNames: readonly string[];
  /** The build command, when a workspace builds the package its own way. */
  buildCommand?: string;
}): string {
  const { site, path } = args;
  const at = path === "" ? "/app" : `/app/${path}`;
  const out = site.output === "." ? at : `${at}/${site.output}`;
  const build = site.build;
  const lines = [
    "# Written by Cira: this site has no server of its own, so its files are",
    "# built and served by nginx. It is part of this upload only.",
  ];
  if (build !== null) {
    lines.push(
      build.manager === "bun"
        ? "FROM oven/bun:1 AS build"
        : `FROM node:${build.nodeMajor}-slim AS build`,
      "WORKDIR /app",
      "ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0",
      // The site's own public variables are compiled in at build time.
      ...args.publicNames.flatMap((name) => [`ARG ${name}`, `ENV ${name}=$${name}`]),
      "COPY . .",
      ...(build.manager === "bun" ? [] : ["RUN corepack enable"]),
      `RUN ${installCommand(build.manager, build.yarnBerry)}`,
      `RUN ${args.buildCommand ?? `cd ${at} && ${RUN[build.manager]} build`}`,
    );
  }
  lines.push(
    "FROM nginx:1.27-alpine",
    `COPY ${NGINX_CONF} /etc/nginx/conf.d/default.conf`,
    build === null
      ? `COPY ${path === "" ? "." : path} /usr/share/nginx/html`
      : `COPY --from=build ${out} /usr/share/nginx/html`,
    "EXPOSE 8080",
    "",
  );
  return lines.join("\n");
}

/** Where the server's settings sit in the upload. */
export const NGINX_CONF = ".cira/static.nginx.conf";

/**
 * Listening where Cloud Run sends requests, a missing path answered by the
 * app's own `index.html`, and built assets cached hard because their names
 * change whenever they do.
 */
export const NGINX_CONFIG = `server {
  listen 8080;
  root /usr/share/nginx/html;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }

  location ~* \\.(?:js|css|woff2?|png|jpe?g|gif|svg|ico|webp|avif)$ {
    try_files $uri =404;
    expires 30d;
    add_header Cache-Control "public, immutable";
  }
}
`;

function readJson(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
