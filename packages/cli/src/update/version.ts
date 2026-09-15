import { readFileSync } from "node:fs";

/**
 * Versions, compared the little that Cira needs.
 *
 * The CLI and the Skill ship as one release and carry one number, so there is
 * no compatibility matrix to consult - only "is the published one newer than
 * mine". Anything more is a problem Cira does not have yet.
 */

const MANIFEST = new URL("../../package.json", import.meta.url);

export function currentVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(MANIFEST, "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
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
