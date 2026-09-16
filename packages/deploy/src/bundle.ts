/**
 * Deciding what of a project folder is worth uploading.
 *
 * Kept free of the filesystem so the rules can be tested directly, and so the
 * same decisions apply whoever is walking the tree.
 */

/**
 * Never uploaded. Build output and dependencies are reproduced by the build,
 * and the rest is either private, enormous, or both.
 *
 * `.env` is the one that matters: a developer's local secrets must not be
 * shipped to a build server because they happened to be in the folder.
 */
const EXCLUDED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  ".cira",
  "dist",
  "build",
  "out",
  "coverage",
  ".cache",
  ".DS_Store",
]);

const EXCLUDED_FILE_PATTERNS = [
  /^\.env($|\.)/,
  /\.log$/,
  /^\.DS_Store$/,
  /\.tsbuildinfo$/,
  /^npm-debug\.log/,
  /^yarn-error\.log/,
];

export function isExcludedDirectory(name: string): boolean {
  return EXCLUDED_DIRECTORIES.has(name);
}

export function isExcludedFile(name: string): boolean {
  if (name === ".env.example") return false;
  return EXCLUDED_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

/** Should this path, relative to the project root, be uploaded? */
export function shouldUpload(relativePath: string): boolean {
  const segments = relativePath.split("/").filter((s) => s !== "");
  if (segments.length === 0) return false;

  for (const segment of segments.slice(0, -1)) {
    if (isExcludedDirectory(segment)) return false;
  }

  const name = segments[segments.length - 1];
  if (name === undefined) return false;
  if (isExcludedDirectory(name)) return false;
  return !isExcludedFile(name);
}

/** Uploading more than this is a mistake, not a big project. */
export const MAX_BUNDLE_BYTES = 100 * 1024 * 1024;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface BundleFile {
  path: string;
  size: number;
}

export type BundleVerdict = { ok: true } | { ok: false; reason: string };

export function checkBundle(files: readonly BundleFile[]): BundleVerdict {
  if (files.length === 0) {
    return { ok: false, reason: "There is nothing to deploy in this folder." };
  }

  const oversized = files.find((f) => f.size > MAX_FILE_BYTES);
  if (oversized !== undefined) {
    return {
      ok: false,
      reason: `${oversized.path} is larger than 25 MB. Deployments carry source, not assets that big.`,
    };
  }

  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_BUNDLE_BYTES) {
    return {
      ok: false,
      reason:
        "This folder is over 100 MB. Something that should be ignored is probably being uploaded.",
    };
  }

  return { ok: true };
}
