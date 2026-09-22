import type { ArchiveEntry } from "./archive.js";
import { isSecretFile } from "./bundle.js";

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

/**
 * How much source one analysis may carry.
 *
 * Sized against the model's context window rather than chosen for roundness,
 * which the previous figure was. Source code runs about 3.5 characters to the
 * token, so 1.5 MB is roughly 430,000 tokens - more than twice what a 200,000
 * token context holds, and every analysis of a repository that large failed
 * outright with `prompt is too long`. Wave's did, on every deploy, for weeks.
 *
 *   200,000  context
 *    -3,000  the system prompt
 *   -64,000  room for the answer (MAX_TOKENS in capability-analyzer.ts)
 *   =133,000 tokens, times 3.5 characters, is about 465,000
 *
 * Set below that, because the ratio is an average and a repository full of
 * dense configuration beats it. The answer's room was 32,000 once, and a large
 * app's list of capabilities ran past it and came back as nothing at all;
 * less source, read in the right order, is the better trade. A repository too
 * large to fit still analyses - the files most likely to declare routes go in
 * first and the rest is reported as omitted.
 */
export const MAX_PACKED_BYTES = 420_000;

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
 * Which files are read first, when not everything fits.
 *
 * It used to be the alphabet, so a repository whose docs, styles and
 * components sorted early could fill the budget before the one file that
 * declares its routes. Now, in order: what declares routes, then the rest of
 * the code, then what is prose, styling or data, then tests.
 *
 * Tests go last, not out. They are often the clearest statement of what an
 * endpoint is for - Wave's full request paths appear nowhere but its tests,
 * because the application builds them from a prefix constant. So they earn
 * their place when there is room and lose it first when there is not.
 */
export function priority(path: string, head: string): number {
  if (/(^|\/)(tests?|__tests__|spec|e2e)\//i.test(path)) return 3;
  if (/\.(test|spec)\.[a-z]+$/i.test(path)) return 3;
  if (/\.(md|mdx|rst|txt|css|scss|sass|less|csv|tsv|html?|ya?ml\.example)$/i.test(path)) {
    return 2;
  }
  if (
    /(^|\/)(docs?|public|static|assets|locales?|i18n|fixtures|seeds?|migrations)\//i.test(
      path,
    )
  ) {
    return 2;
  }
  return DECLARES_ROUTES.test(head) ? 0 : 1;
}

/**
 * How a route is declared, across the frameworks internal tools are written
 * in. Only an ordering hint: a file it misses is still read, just later, and
 * nothing is decided from it.
 */
const DECLARES_ROUTES = new RegExp(
  [
    // Express, Fastify, Hono, Koa, Flask, FastAPI, Sinatra-style: app.get("/x"
    String.raw`\b(app|router|api|server|route|bp|blueprint|r|e|g|mux)\.(get|post|put|patch|delete|route|all|api_route|add_url_rule|handle|handlefunc|group|mount|include_router)\s*\(`,
    // Decorators: @app.get(, @router.post(, @Get(, @GetMapping(, @RequestMapping(
    String.raw`@\w*\.?(get|post|put|patch|delete|route)\s*\(`,
    String.raw`@(Get|Post|Put|Patch|Delete|Request)Mapping\b`,
    // Next.js and other file-based handlers
    String.raw`export\s+(async\s+)?(function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD)\b`,
    // Go net/http and chi/gin
    String.raw`\bHandleFunc\s*\(|\.(GET|POST|PUT|PATCH|DELETE)\s*\(\s*"/`,
    // Django, Rails, Laravel
    String.raw`\b(re_)?path\s*\(\s*r?["'][^"']*["']\s*,|\bresources?\s+:|Route::(get|post|put|patch|delete|resource)`,
  ].join("|"),
  "i",
);

function worthReading(entry: ArchiveEntry): boolean {
  const name = entry.path.split("/").pop() ?? "";
  // Never shown to the model, whatever uploaded it. The CLI already refuses to
  // send these, but a CLI installed before it did still can.
  if (isSecretFile(entry.path, entry.body.subarray(0, 64 * 1024).toString("utf8"))) {
    return false;
  }
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
  const ranked = entries.filter(worthReading).map((entry) => ({
    entry,
    rank: priority(entry.path, entry.body.subarray(0, 64 * 1024).toString("utf8")),
  }));
  const candidates = ranked
    .sort((a, b) => a.rank - b.rank || a.entry.path.localeCompare(b.entry.path))
    .map((r) => r.entry);

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
