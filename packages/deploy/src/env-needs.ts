import type { ArchiveEntry } from "./archive.js";

/**
 * What an app will need told to it before it can work.
 *
 * Deliberately simple, and deliberately not exhaustive. This is the cheap
 * pass: it reads what a repository plainly says about itself and leaves the
 * rest to the model, because a scanner trying to understand every framework's
 * configuration only becomes a worse version of one.
 *
 * Two things are worth finding, and they are not the same thing.
 *
 * A value read from the environment with nothing to fall back on is required
 * outright: without it the app crashes, or reads undefined and behaves oddly.
 *
 * A value that falls back to localhost is subtler, and is the one that bit
 * Wave. The app starts, because there is a default. The default names a
 * service on the developer's own machine, which inside a container is nothing
 * at all. So the build goes green, the container boots, the front page renders,
 * and it fails the moment anybody touches the half that needed a database.
 */

export interface EnvNeed {
  name: string;
  /** Why it matters, in the words the CLI will use. */
  reason: "no default" | "defaults to localhost";
  /** Where it was found, so somebody can go and look. */
  file: string;
}

/**
 * Places that talk about environment variables without reading any.
 *
 * Documentation is the worst offender: a skill file explaining how to set
 * `SENTRY_DSN` looks exactly like code reading it, and a repository can carry
 * a great deal of it. Tests are the other: they name a database and a Redis
 * because they stand one up themselves, which says nothing about what the
 * deployed app needs told to it.
 */
const NOT_THE_APP =
  /(^|\/)(\.claude|\.github|docs?|examples?|tests?|__tests__|e2e|spec)(\/|$)|(^|\/)(conftest\.py|test_[^/]*\.py|[^/]*\.(test|spec)\.[jt]sx?|[^/]*_test\.go)$|\.mdx?$/i;

/** Cloud Run sets these, or they mean nothing outside a developer's shell. */
const SUPPLIED = new Set([
  "PORT",
  "NODE_ENV",
  "PYTHONPATH",
  "PATH",
  "HOME",
  "CI",
  "K_SERVICE",
  "K_REVISION",
  "K_CONFIGURATION",
  "NEXT_RUNTIME",
]);

const LOCAL = /\b(localhost|127\.0\.0\.1|0\.0\.0\.0)\b/;

/**
 * Read from the environment. The pattern stops at the closing bracket so the
 * caller can look at what follows and decide whether a fallback was offered.
 */
const READS: ReadonlyArray<RegExp> = [
  /process\.env(?:\.([A-Z][A-Z0-9_]*)|\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\])/g,
  /os\.(?:environ(?:\.get)?\[?\(?|getenv\()\s*["']([A-Z][A-Z0-9_]*)["']/g,
  /ENV(?:\.fetch)?\[?\(?\s*["']([A-Z][A-Z0-9_]*)["']/g,
  /(?:System|os)\.[Gg]etenv\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
];

/**
 * A settings field whose default points at the developer's own machine, in the
 * pydantic or dataclass shape: `redis_url: str = "redis://localhost:6379/0"`.
 */
const LOCAL_DEFAULT =
  /^\s*([a-z][a-z0-9_]*)\s*:\s*[A-Za-z][\w.[\]]*\s*=\s*["']([^"']+)["']/;

/** Enough of a fallback to mean the app copes without being told. */
const FALLBACK = /^\s*[)\]]?\s*(\?\?|\|\||,\s*["']|\bor\b)/;

/**
 * A switch: the value is only compared with a literal, so being unset is one
 * of its states rather than something missing. `os.environ.get("DEBUG") ==
 * "1"`, `process.env.FEATURE === "on"`, `os.getenv("MODE") in ("a", "b")`.
 *
 * Only a literal with something in it counts. A comparison with nothing -
 * `=== undefined`, `is None`, `== ""` - is how an app checks that it was told
 * something it needs, usually on its way to refusing to start.
 */
const SWITCH =
  /^\s*[)\]]?\s*(?:[!=]==?\s*(?:["'`](?!["'`])|\d|true\b|false\b)|(?:not\s+)?in\s*[([{])/;

export function findEnvNeeds(entries: readonly ArchiveEntry[]): EnvNeed[] {
  const found = new Map<string, EnvNeed>();

  const note = (need: EnvNeed) => {
    if (SUPPLIED.has(need.name)) return;

    // A localhost default is the stronger finding and names the better file -
    // a settings class rather than wherever the name first happened to appear
    // - so it replaces a bare read of the same name.
    const seen = found.get(need.name);
    if (seen === undefined || need.reason === "defaults to localhost") {
      if (seen?.reason === "defaults to localhost") return;
      found.set(need.name, need);
    }
  };

  for (const entry of entries) {
    if (NOT_THE_APP.test(entry.path)) continue;
    if (entry.body.length > 400_000) continue;
    if (entry.body.subarray(0, 1024).includes(0)) continue;

    const text = entry.body.toString("utf8");

    for (const pattern of READS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(text)) !== null) {
        const name = match[1] ?? match[2];
        if (name === undefined) continue;

        const end = match.index + match[0].length;
        const after = text.slice(end, end + 24);
        if (FALLBACK.test(after) || SWITCH.test(after)) continue;

        note({ name, reason: "no default", file: entry.path });
      }
    }

    for (const line of text.split("\n")) {
      const declared = LOCAL_DEFAULT.exec(line);
      if (declared === null) continue;

      const [, field, value] = declared;
      if (field === undefined || value === undefined) continue;
      if (!LOCAL.test(value)) continue;

      note({
        name: field.toUpperCase(),
        reason: "defaults to localhost",
        file: entry.path,
      });
    }
  }

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}
