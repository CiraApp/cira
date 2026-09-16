import { copyFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { build } from "esbuild";

/**
 * Bundle the CLI into one file with no dependencies.
 *
 * `@cira/core`, `@cira/deploy` and `@cira/extract` are Cira's own internals
 * with no consumers outside this repository. Publishing them to reach the CLI
 * would mean committing to their names and their APIs in public, forever, for
 * nobody - so the CLI ships as a single self-contained file instead. It has no
 * third-party runtime dependencies at all, which is what makes that possible.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const skill = join(root, "..", "cira-skill", "SKILL.md");

rmSync(join(root, "bin"), { recursive: true, force: true });
mkdirSync(join(root, "bin"), { recursive: true });

await build({
  entryPoints: [join(root, "dist", "index.js")],
  outfile: join(root, "bin", "cira.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Nothing is external: the CLI depends only on Cira's own packages and on
  // what Node already provides.
  packages: "bundle",
  // No shebang banner: esbuild carries the entry's own through, and adding a
  // second one puts it on line 2, where it is a syntax error rather than a
  // shebang. Only a real install surfaced that.
  legalComments: "none",
});

/**
 * A ceiling, not a target.
 *
 * The CLI is a few thousand lines of its own code; anything approaching this
 * is a third-party package that arrived by accident. That has happened once
 * already - importing `@cira/deploy` at its main entry pulled in Google's auth
 * library and took the bundle past a megabyte - and it is invisible in a diff,
 * because the import that causes it looks identical to one that does not.
 */
const MAX_BUNDLE_BYTES = 250 * 1024;

const bundled = statSync(join(root, "bin", "cira.js")).size;
if (bundled > MAX_BUNDLE_BYTES) {
  const kb = (n) => `${Math.round(n / 1024)} KB`;
  throw new Error(
    `bin/cira.js is ${kb(bundled)}, over the ${kb(MAX_BUNDLE_BYTES)} ceiling. ` +
      `Something is importing a third-party package - check what @cira/deploy ` +
      `is being imported from, and prefer @cira/deploy/packaging.`,
  );
}

// The canonical skill travels with the CLI and is read at runtime, relative to
// the package root - the same place it sits when installed from the registry.
copyFileSync(skill, join(root, "SKILL.md"));

process.stdout.write(`bundled bin/cira.js (${Math.round(bundled / 1024)} KB)\n`);
