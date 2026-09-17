import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Score one analyzer run against the answer key.
 *
 * Takes the JSON the analyzer produced for `corpus.txt` and says how much of
 * it was right. Exits non-zero on anything short of perfect, so it can be the
 * last step of a prompt change rather than something read and nodded at.
 *
 * Usage:  node fixtures/capability-analyzer/score.mjs <result.json>
 */

const here = dirname(fileURLToPath(import.meta.url));
const resultPath = process.argv[2];

if (resultPath === undefined) {
  console.error("usage: node score.mjs <result.json>");
  process.exit(2);
}

const truth = new Set(
  readFileSync(join(here, "truth.txt"), "utf8").trim().split("\n").filter(Boolean),
);
const forbidden = readFileSync(join(here, "excluded.txt"), "utf8")
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => line.split(/\s{2,}|\s\(/)[0].trim());

const result = JSON.parse(readFileSync(resultPath, "utf8"));
const capabilities = result.capabilities ?? [];
const claimed = capabilities.map((c) => `${c.method} ${c.path}`);

const invented = claimed.filter((c) => !truth.has(c));
const missed = [...truth].filter((t) => !claimed.includes(t));
const trapped = claimed.filter((c) =>
  forbidden.some((f) => c === f || c.startsWith(f.replace("*", ""))),
);

const say = (text) => process.stdout.write(`${text}\n`);
const line = (label, value) => say(`  ${label.padEnd(24)} ${value}`);

say(`\n${resultPath}\n`);
line("claimed", claimed.length);
line("correct", `${claimed.length - invented.length} / ${truth.size}`);
line("invented", invented.length ? invented.join(", ") : "none");
line("missed", missed.length ? missed.join(", ") : "none");
line("should not be here", trapped.length ? trapped.join(", ") : "none");

// A probe is how the app is asked whether a read really exists, so a read
// without one cannot be checked; a write must never have one, because a write
// is never called to test it.
const probeWrong = capabilities.filter(
  (c) => (c.risk === "read") !== (c.probe !== undefined),
);
line(
  "probe on reads only",
  probeWrong.length === 0 ? "yes" : `no (${probeWrong.length})`,
);

const names = new Set(capabilities.map((c) => c.name));
line("names unique", names.size === capabilities.length ? "yes" : "no");

const perfect =
  invented.length === 0 &&
  missed.length === 0 &&
  trapped.length === 0 &&
  probeWrong.length === 0 &&
  names.size === capabilities.length;

say(`\n  ${perfect ? "PASS" : "FAIL"}\n`);
process.exit(perfect ? 0 : 1);
