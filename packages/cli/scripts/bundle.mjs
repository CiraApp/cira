import { copyFileSync, mkdirSync, rmSync } from "node:fs";
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

// The canonical skill travels with the CLI and is read at runtime, relative to
// the package root - the same place it sits when installed from the registry.
copyFileSync(skill, join(root, "SKILL.md"));

process.stdout.write("bundled bin/cira.js\n");
