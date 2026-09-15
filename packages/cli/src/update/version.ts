import { readFileSync } from "node:fs";

/**
 * Versions, compared the little that Cira needs.
 *
 * The CLI and the Skill ship as one release and carry one number, so there is
 * no compatibility matrix to consult - only "is the published one newer than
 * mine". Anything more is a problem Cira does not have yet.
 */

/**
 * The CLI runs from two shapes: compiled to `dist/update/version.js` in this
 * repository, and bundled to `bin/cira.js` when installed from the registry.
 * Both sit inside the package, at different depths, so both are tried.
 */
const MANIFESTS = ["../package.json", "../../package.json"];

export function currentVersion(): string {
  for (const candidate of MANIFESTS) {
    try {
      const pkg = JSON.parse(
        readFileSync(new URL(candidate, import.meta.url), "utf8"),
      ) as { name?: unknown; version?: unknown };
      // Guard against finding some other package.json further up the tree.
      if (pkg.name !== "@cira-app/cli") continue;
      if (typeof pkg.version === "string") return pkg.version;
    } catch {
      // Try the next shape.
    }
  }
  return "0.0.0";
}

/**
 * Is `candidate` a later release than `current`?
 *
 * Three numbers, compared in order. A version carrying a prerelease suffix is
 * treated as the release before it, which is the conservative reading: it is
 * never offered as an upgrade over the plain release of the same number.
 */
export function isNewer(candidate: string, current: string): boolean {
  const a = parse(candidate);
  const b = parse(current);
  if (a === null || b === null) return false;

  for (let i = 0; i < 3; i += 1) {
    const left = a.parts[i] ?? 0;
    const right = b.parts[i] ?? 0;
    if (left !== right) return left > right;
  }

  // Same numbers: a prerelease is behind the plain release, never ahead.
  return b.prerelease && !a.prerelease;
}

function parse(value: string): { parts: number[]; prerelease: boolean } | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+](.*))?$/.exec(value.trim());
  if (match === null) return null;

  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] !== undefined && match[4] !== "",
  };
}
