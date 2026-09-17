import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Print the prompt the analyzer actually ships with.
 *
 * Read out of the source rather than kept beside the fixture, because a second
 * copy is a copy that drifts - and a fixture scoring a prompt nobody uses is
 * worse than no fixture.
 */
const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  join(here, "..", "..", "apps", "web", "src", "lib", "capability-analyzer.ts"),
  "utf8",
);

const match = /const SYSTEM = `([\s\S]*?)`;\n/.exec(source);
if (match?.[1] === undefined) {
  console.error("could not find the SYSTEM prompt in capability-analyzer.ts");
  process.exit(2);
}

process.stdout.write(match[1].replace(/\\`/g, "`").replace(/\\\$\{/g, "${"));
