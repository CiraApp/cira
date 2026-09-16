import { mkdirSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { build } from "esbuild";

/**
 * Bundle the proxy into one module.
 *
 * It shares `@cira/core` with Cira, which is the point: the signature check
 * here and the signing there are the same code, so they cannot drift into
 * disagreeing - and the disagreement that matters is the one where this side
 * accepts something Cira would not have signed.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

rmSync(join(root, "build"), { recursive: true, force: true });
mkdirSync(join(root, "build"), { recursive: true });

await build({
  entryPoints: [join(root, "dist", "index.js")],
  outfile: join(root, "build", "worker.js"),
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "neutral",
  packages: "bundle",
  legalComments: "none",
});

const size = statSync(join(root, "build", "worker.js")).size;
process.stdout.write(`bundled build/worker.js (${Math.round(size / 1024)} KB)\n`);
