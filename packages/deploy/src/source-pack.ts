import type { ArchiveEntry } from "./archive.js";

/**
 * A repository, as one thing a model can read.
 *
 * There is no cleverness here on purpose. The previous analyzer tried to
 * understand a repository before showing it to anyone - which routes existed,
 * which functions mattered, which 900 characters of each were worth keeping -
 * and all of that understanding was Next.js-shaped, so a Python service came
 * out empty. Reading the code is both simpler and more accurate, and it is
 * simpler in the way that matters: nothing in this file knows what language
 * anything is written in.
 *
 * What is left is deciding what is not worth reading at all. A lockfile, a
 * PNG and a minified bundle are not things anybody wrote, and they would
 * crowd out things somebody did.
 */

/** Big enough for every real internal tool, small enough to stay cheap. */
export const MAX_PACKED_BYTES = 1_500_000;

/** Beyond this a single file is generated, whatever its extension claims. */
const MAX_FILE_BYTES = 200_000;

const LOCKFILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "poetry.lock",
  "uv.lock",
  "Cargo.lock",
  "composer.lock",
  "Gemfile.lock",
  "go.sum",
]);

/** Not source, whatever else they are. */
const OPAQUE =
  /\.(png|jpe?g|gif|webp|avif|ico|svg|bmp|pdf|zip|gz|tgz|bz2|xz|woff2?|ttf|otf|eot|mp[34]|mov|wav|webm|class|jar|so|dylib|dll|exe|wasm|bin|db|sqlite3?|pyc|pack|idx)$/i;

const GENERATED = /\.(min\.(js|css)|map|snap)$/i;

export interface PackedSource {
  /** What the model reads. */
  text: string;
  /** Files included, in the order they appear. */
  included: string[];
  /**
   * Files left out for room, nearest the budget first.
   *
   * Reported rather than swallowed, because "the analyzer did not see half
   * your repository" is the sort of thing that should be visible when the
   * answer looks thin.
   */
  omitted: string[];
  bytes: number;
}

/**
 * Tests go last, not out.
 *
 * They are often the clearest statement of what an endpoint is for - Wave's
 * full request paths appear nowhere but its tests, because the application
 * builds them from a prefix constant. So they earn their place when there is
 * room and lose it first when there is not.
 */
function priority(path: string): number {
  if (/(^|\/)(tests?|__tests__|spec)\//i.test(path)) return 1;
  if (/\.(test|spec)\.[a-z]+$/i.test(path)) return 1;
  return 0;
}

function worthReading(entry: ArchiveEntry): boolean {
  const name = entry.path.split("/").pop() ?? "";
  if (LOCKFILES.has(name)) return false;
  if (OPAQUE.test(entry.path) || GENERATED.test(entry.path)) return false;
  if (entry.body.length === 0 || entry.body.length > MAX_FILE_BYTES) return false;

  // Whatever the name says, a NUL byte early on means this is not text. Cheap,
  // and catches the extensions nobody thought of.
  return !entry.body.subarray(0, 1024).includes(0);
}

export function packSource(
  entries: readonly ArchiveEntry[],
  budget: number = MAX_PACKED_BYTES,
): PackedSource {
  const candidates = entries
    .filter(worthReading)
    .sort((a, b) => priority(a.path) - priority(b.path) || a.path.localeCompare(b.path));

  const parts: string[] = [];
  const included: string[] = [];
  const omitted: string[] = [];
  let bytes = 0;

  for (const entry of candidates) {
    const block = `--- ${entry.path} ---\n${entry.body.toString("utf8")}\n`;
    const size = Buffer.byteLength(block, "utf8");

    // Skipped rather than stopped: one enormous file near the top of the
    // alphabet should not cost every file after it.
    if (bytes + size > budget) {
      omitted.push(entry.path);
      continue;
    }

    parts.push(block);
    included.push(entry.path);
    bytes += size;
  }

  return { text: parts.join("\n"), included, omitted, bytes };
}
